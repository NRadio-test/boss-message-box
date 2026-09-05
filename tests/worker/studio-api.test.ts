import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../worker/env";
import { WebCryptoPhoneService } from "../../worker/security/crypto";
import { hashPassword } from "../../worker/security/password";

const ORIGIN = "https://message.example";
const testEnv = env as unknown as Env;
const TEST_PASSWORD = "studio-fixture-password-2026";
const testPasswordHash = await hashPassword(TEST_PASSWORD);
const bootstrapAccounts = await testEnv.BOSS_MESSAGE_DB.prepare("SELECT must_change_password FROM admins").all<{ must_change_password: number }>();

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Origin", ORIGIN);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function login(username = "zd", password = TEST_PASSWORD): Promise<{ response: Response; cookie: string }> {
  const response = await api("/api/studio/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  const setCookie = response.headers.get("Set-Cookie") ?? "";
  return { response, cookie: setCookie.split(";", 1)[0] ?? "" };
}

async function seedFeedbackWithImage(): Promise<{
  feedbackId: string;
  imageId: string;
  userId: string;
}> {
  const now = Date.now();
  const userId = crypto.randomUUID();
  const feedbackId = crypto.randomUUID();
  const imageId = crypto.randomUUID();
  const phone = "13906325777";
  const phoneCrypto = new WebCryptoPhoneService(testEnv.PHONE_HASH_KEY, testEnv.PHONE_ENCRYPTION_KEY);
  const phoneHash = await phoneCrypto.hash(phone);
  const phoneEncrypted = await phoneCrypto.encrypt(phone, phoneHash);
  const objectKey = `feedback-images/${feedbackId}/${imageId}.webp`;

  await testEnv.BOSS_MESSAGE_DB.batch([
    testEnv.BOSS_MESSAGE_DB
      .prepare(
        `INSERT INTO users
          (id, phone_encrypted, phone_hash, douyin_nickname, created_at, updated_at)
         VALUES (?, ?, ?, '接口测试昵称', ?, ?)`,
      )
      .bind(userId, phoneEncrypted, phoneHash, now, now),
    testEnv.BOSS_MESSAGE_DB
      .prepare(
        `INSERT INTO feedback
          (id, submission_key, user_id, douyin_nickname, topic, custom_topic, content, internal_status,
           reply_type, reply_content, privacy_policy_version, privacy_agreed_at,
           livestream_policy_version, livestream_agreed_at, moderation_status,
           created_at, updated_at, is_todo)
         VALUES (?, ?, ?, '接口测试昵称', 'appeal', NULL, '需要处理的留言', 'unprocessed', NULL, NULL,
                 'v1', ?, 'v1', ?, 'kept', ?, ?, 1)`,
      )
      .bind(feedbackId, crypto.randomUUID(), userId, now, now, now, now),
    testEnv.BOSS_MESSAGE_DB
      .prepare(
        `INSERT INTO feedback_images
          (id, feedback_id, object_key, media_type, byte_size, width, height, sha256, created_at)
         VALUES (?, ?, ?, 'image/webp', 12, 1, 1, 'fixture', ?)`,
      )
      .bind(imageId, feedbackId, objectKey, now),
  ]);
  await testEnv.BOSS_MESSAGE_IMAGES.put(objectKey, new Uint8Array([82, 73, 70, 70]), {
    httpMetadata: { contentType: "image/webp" },
  });
  return { feedbackId, imageId, userId };
}

describe("Studio API", () => {
  beforeEach(async () => {
    const objects = await testEnv.BOSS_MESSAGE_IMAGES.list({ prefix: "feedback-images/" });
    if (objects.objects.length > 0) {
      await testEnv.BOSS_MESSAGE_IMAGES.delete(objects.objects.map((object) => object.key));
    }
    await testEnv.BOSS_MESSAGE_DB.batch([
      testEnv.BOSS_MESSAGE_DB.prepare("DELETE FROM audit_logs"),
      testEnv.BOSS_MESSAGE_DB.prepare("DELETE FROM feedback_replies"),
      testEnv.BOSS_MESSAGE_DB.prepare("DELETE FROM feedback_images"),
      testEnv.BOSS_MESSAGE_DB.prepare("DELETE FROM feedback"),
      testEnv.BOSS_MESSAGE_DB.prepare("DELETE FROM users"),
      testEnv.BOSS_MESSAGE_DB.prepare("DELETE FROM admin_sessions"),
      testEnv.BOSS_MESSAGE_DB.prepare("DELETE FROM rate_limits"),
      testEnv.BOSS_MESSAGE_DB.prepare("UPDATE admins SET password_hash = ?, must_change_password = 0").bind(testPasswordHash),
    ]);
  });

  it("authenticates initialized accounts with a hashed password and a 30-day server session", async () => {
    const rawTokens: string[] = [];
    for (const username of ["zd", "mm", "fa", "ceshi"]) {
      const { response, cookie } = await login(username);
      expect(response.status).toBe(200);
      expect(cookie).toMatch(/^__Host-boss_studio_session=[A-Za-z0-9_-]{43}$/u);
      const setCookie = response.headers.get("Set-Cookie") ?? "";
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("Secure");
      expect(setCookie).toContain("SameSite=Strict");
      expect(setCookie).toContain("Max-Age=2592000");
      rawTokens.push(cookie.split("=")[1] ?? "");
    }

    const stored = await testEnv.BOSS_MESSAGE_DB
      .prepare("SELECT username, password_hash FROM admins ORDER BY username")
      .all<{ username: string; password_hash: string }>();
    expect(stored.results).toHaveLength(4);
    expect(stored.results.every((row) => row.password_hash.startsWith("pbkdf2-sha256$"))).toBe(true);
    expect(JSON.stringify(stored.results)).not.toContain('"admin"');

    const sessions = await testEnv.BOSS_MESSAGE_DB
      .prepare("SELECT token_hash, created_at, expires_at FROM admin_sessions")
      .all<{ token_hash: string; created_at: number; expires_at: number }>();
    expect(sessions.results).toHaveLength(4);
    expect(sessions.results.every((row) => row.expires_at - row.created_at === 2_592_000_000)).toBe(true);
    expect(rawTokens.every((token) => !sessions.results.some((row) => row.token_hash === token))).toBe(true);

    expect((await login("zd", "wrong-password")).response.status).toBe(401);
    expect((await api("/api/studio/feedbacks")).status).toBe(401);
    expect((await SELF.fetch(`${ORIGIN}/api/studio/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "zd", password: "admin" }),
    })).status).toBe(403);
  });

  it("rate limits repeated login failures", async () => {
    let last: Response | null = null;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      last = (await login("zd", "incorrect")).response;
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("Retry-After")).toMatch(/^\d+$/u);
  });

  it("enforces live-mode privacy, forces live replies, and serves only authenticated R2 images", async () => {
    const seeded = await seedFeedbackWithImage();
    const { cookie } = await login();
    const authenticated = { Cookie: cookie };

    const appealList = await api("/api/studio/feedbacks?view=unreplied&topic=appeal", {
      headers: authenticated,
    });
    expect(appealList.status).toBe(200);
    expect(await appealList.json()).toMatchObject({
      items: [{ id: seeded.feedbackId, topic: "appeal" }],
      pagination: { total: 1 },
    });
    const emptyTopicList = await api("/api/studio/feedbacks?view=unreplied&topic=released_hardware", {
      headers: authenticated,
    });
    expect(await emptyTopicList.json()).toMatchObject({ items: [], pagination: { total: 0 } });
    expect((await api("/api/studio/feedbacks?topic=not-a-topic", { headers: authenticated })).status).toBe(400);

    const detailResponse = await api(`/api/studio/feedbacks/${seeded.feedbackId}`, {
      headers: authenticated,
    });
    expect(detailResponse.status).toBe(200);
    const detailText = await detailResponse.text();
    expect(detailText).toContain("1**********");
    expect(detailText).not.toContain("13906325777");
    expect(detailText).not.toContain("phoneEncrypted");

    const reveal = await api(`/api/studio/users/${seeded.userId}/reveal-phone`, {
      method: "POST",
      headers: authenticated,
      body: "{}",
    });
    expect(await reveal.json()).toEqual({ ok: true, phone: "13906325777" });

    for (const body of [
      { query: "接口测试昵称", page: 1 },
      { query: seeded.feedbackId.slice(0, 8).toUpperCase(), page: 1 },
    ]) {
      const search = await api("/api/studio/search", {
        method: "POST",
        headers: authenticated,
        body: JSON.stringify(body),
      });
      expect(search.status).toBe(200);
      expect((await search.json() as { items: Array<{ id: string }> }).items[0]?.id).toBe(seeded.feedbackId);
    }

    const normalReply = await api(`/api/studio/feedbacks/${seeded.feedbackId}/replies`, {
      method: "POST",
      headers: authenticated,
      body: JSON.stringify({
        replyType: "message",
        content: "留言回复",
        adminId: "admin-fa",
      }),
    });
    expect(await normalReply.json()).toMatchObject({
      ok: true,
      reply: { replyType: "message", adminUsername: "zd" },
      isTodo: false,
    });

    const mode = await api("/api/studio/session/mode", {
      method: "PUT",
      headers: authenticated,
      body: JSON.stringify({ mode: "live" }),
    });
    expect(mode.status).toBe(200);
    expect((await mode.json() as { mode: string }).mode).toBe("live");

    const forbiddenReveal = await api(`/api/studio/users/${seeded.userId}/reveal-phone`, {
      method: "POST",
      headers: authenticated,
      body: "{}",
    });
    expect(forbiddenReveal.status).toBe(403);
    expect(await forbiddenReveal.text()).not.toContain("13906325777");

    const reply = await api(`/api/studio/feedbacks/${seeded.feedbackId}/replies`, {
      method: "POST",
      headers: authenticated,
      body: JSON.stringify({ replyType: "message", content: "直播现场回复", adminId: "admin-fa" }),
    });
    expect(reply.status).toBe(200);
    expect(await reply.json()).toMatchObject({ ok: true, reply: { replyType: "live", content: "直播现场回复" }, isTodo: false });

    const persistedReplies = await testEnv.BOSS_MESSAGE_DB
      .prepare("SELECT reply_type, admin_id FROM feedback_replies WHERE feedback_id = ? ORDER BY created_at, id")
      .bind(seeded.feedbackId)
      .all<{ reply_type: string; admin_id: string }>();
    expect(persistedReplies.results).toEqual([
      { reply_type: "message", admin_id: "admin-zd" },
      { reply_type: "live", admin_id: "admin-zd" },
    ]);

    const publicHistory = await api("/api/history", {
      method: "POST",
      body: JSON.stringify({ nickname: "接口测试昵称" }),
    });
    const publicHistoryText = await publicHistory.text();
    expect(publicHistory.status).toBe(200);
    expect(publicHistoryText).toContain('"replyType":"message"');
    expect(publicHistoryText).toContain('"replyType":"live"');
    expect(publicHistoryText).not.toContain("admin-zd");
    expect(publicHistoryText).not.toContain('"adminUsername"');

    const imagePath = `/api/studio/feedbacks/${seeded.feedbackId}/images/${seeded.imageId}`;
    expect((await api(imagePath)).status).toBe(401);
    const image = await api(imagePath, { headers: authenticated });
    expect(image.status).toBe(200);
    expect(image.headers.get("Content-Type")).toBe("image/webp");
    expect(image.headers.get("Cache-Control")).toBe("private, no-store");
    expect(image.headers.get("Content-Disposition")).toContain("inline");
    const download = await api(`${imagePath}?download=1`, { headers: authenticated });
    expect(download.headers.get("Content-Disposition")).toContain("attachment");

    const logout = await api("/api/studio/logout", {
      method: "POST",
      headers: authenticated,
      body: "{}",
    });
    expect(logout.status).toBe(200);
    expect((await api("/api/studio/session", { headers: authenticated })).status).toBe(401);
  });

  it("blocks bootstrap passwords and revokes all sessions after changing a password", async () => {
    expect(bootstrapAccounts.results).toHaveLength(4);
    expect(bootstrapAccounts.results.every((admin) => admin.must_change_password === 1)).toBe(true);
    await testEnv.BOSS_MESSAGE_DB.prepare("UPDATE admins SET must_change_password = 1 WHERE username = 'zd'").run();
    expect((await login()).response.status).toBe(403);
    await testEnv.BOSS_MESSAGE_DB.prepare("UPDATE admins SET must_change_password = 0 WHERE username = 'zd'").run();
    const first = await login();
    const second = await login();
    const request = (currentPassword: string, newPassword: string) => api("/api/studio/password", {
      method: "POST", headers: { Cookie: first.cookie }, body: JSON.stringify({ currentPassword, newPassword }),
    });
    expect((await request("wrong", "next-studio-fixture-password")).status).toBe(400);
    expect((await request(TEST_PASSWORD, "short")).status).toBe(400);
    expect((await request(TEST_PASSWORD, "next-studio-fixture-password")).status).toBe(200);
    for (const cookie of [first.cookie, second.cookie]) {
      expect((await api("/api/studio/session", { headers: { Cookie: cookie } })).status).toBe(401);
    }
    expect((await login("zd", TEST_PASSWORD)).response.status).toBe(401);
    expect((await login("zd", "next-studio-fixture-password")).response.status).toBe(200);
  });

  it("disables OTP by default without invoking the old provider", async () => {
    const response = await api("/api/otp/request", { method: "POST", body: "{}" });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("does not display pending moderation in live mode or accept replies before approval", async () => {
    const seeded = await seedFeedbackWithImage();
    const { cookie } = await login();
    const headers = { Cookie: cookie };
    await testEnv.BOSS_MESSAGE_DB.prepare("UPDATE feedback SET moderation_status = 'pending' WHERE id = ?").bind(seeded.feedbackId).run();
    await api("/api/studio/session/mode", { method: "PUT", headers, body: JSON.stringify({ mode: "live" }) });
    expect(await (await api("/api/studio/feedbacks", { headers })).json()).toMatchObject({ items: [] });
    expect((await api(`/api/studio/feedbacks/${seeded.feedbackId}`, { headers })).status).toBe(403);
    expect((await api(`/api/studio/feedbacks/${seeded.feedbackId}/images/${seeded.imageId}`, { headers })).status).toBe(404);
    expect((await api(`/api/studio/feedbacks/${seeded.feedbackId}/replies`, {
      method: "POST", headers, body: JSON.stringify({ replyType: "live", content: "尚未审核" }),
    })).status).toBe(403);
  });
});
