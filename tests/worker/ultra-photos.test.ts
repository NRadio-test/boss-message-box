import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { R2UltraPhotos } from "../../worker/infra/r2-ultra-photos";
import { ULTRA_PHOTO_PREFIX } from "../../src/shared/ultra-photo-contracts";
import { sha256 } from "../../worker/security/crypto";

const bucket = env.BOSS_MESSAGE_IMAGES;
const photos = new R2UltraPhotos(bucket);
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]);
beforeEach(async () => {
  const old = await bucket.list({ prefix: ULTRA_PHOTO_PREFIX });
  if (old.objects.length) await bucket.delete(old.objects.map(item => item.key));
  await env.BOSS_MESSAGE_DB.prepare("DELETE FROM admin_sessions").run();
  await env.BOSS_MESSAGE_DB.prepare("UPDATE admins SET must_change_password = 0").run();
});
describe("Ultra arrival originals", () => {
  it("round-trips punctuation/Unicode filenames and lists the already-imported raw-name originals", async () => {
    const encoded = await photos.upload(new File([jpeg], "爱..jpg"), crypto.randomUUID());
    const legacyId = crypto.randomUUID();
    await bucket.put(`${ULTRA_PHOTO_PREFIX}${legacyId}/小财满福ഒ.jpg`, jpeg, { httpMetadata: { contentType: "image/jpeg" } });
    expect(await photos.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: encoded.id, fileName: "爱..jpg", senderName: "爱." }),
      expect.objectContaining({ id: legacyId, fileName: "小财满福ഒ.jpg", senderName: "小财满福ഒ" }),
    ]));
    expect(new Uint8Array(await (await photos.object(encoded.id))!.arrayBuffer())).toEqual(jpeg);
  });
  it("stores the original bytes and sender filename, newest first, and retries without duplicates", async () => {
    const first = await photos.upload(new File([jpeg], "刘工（1）.jpg"), crypto.randomUUID());
    const second = await photos.upload(new File([jpeg], "沐青🔥.jpg"), crypto.randomUUID());
    const retry = await photos.upload(new File([jpeg], "刘工（1）.jpg"), first.id);
    expect(retry.id).toBe(first.id); expect(retry.uploadedAt).toBe(first.uploadedAt);
    const list = await photos.list();
    expect(list).toHaveLength(2);
    expect(list.find(item => item.id === second.id)).toMatchObject({ senderName: "沐青🔥", fileName: "沐青🔥.jpg" });
    expect(list[0]!.uploadedAt).toBeGreaterThanOrEqual(list[1]!.uploadedAt);
    expect(new Uint8Array(await (await photos.object(first.id))!.arrayBuffer())).toEqual(jpeg);
    await expect(photos.upload(new File([jpeg], "另一个人.jpg"), first.id)).rejects.toMatchObject({ status: 409 });
    await expect(photos.upload(new File(["<svg/>"], "伪装.jpg"), crypto.randomUUID())).rejects.toMatchObject({ status: 400 });
    await expect(photos.upload(new File([jpeg], "../照片.jpg"), crypto.randomUUID())).rejects.toMatchObject({ status: 400 });
  });
  it("requires admin login for previews, same-origin normal mode for uploads, and allows live reads", async () => {
    const origin = "https://message.example";
    const token = "u".repeat(43);
    const hash = await sha256(new TextEncoder().encode(token).buffer as ArrayBuffer);
    await env.BOSS_MESSAGE_DB.prepare("INSERT INTO admin_sessions(token_hash, admin_id, mode, created_at, expires_at) VALUES (?, 'admin-zd', 'normal', 1, ?)")
      .bind(hash, Date.now() + 60_000).run();
    const headers = { Cookie: `__Host-boss_studio_session=${token}`, Origin: origin };
    const url = `${origin}/api/studio/ultra-photos`;
    expect((await SELF.fetch(url)).status).toBe(401);
    const form = () => { const data = new FormData(); data.set("photo", new File([jpeg], "发送者.jpg")); data.set("requestKey", crypto.randomUUID()); return data; };
    expect((await SELF.fetch(url, { method: "POST", headers: { ...headers, Origin: "https://other.example" }, body: form() })).status).toBe(403);
    const uploaded = await SELF.fetch(url, { method: "POST", headers, body: form() });
    expect(uploaded.status).toBe(200);
    const { item } = await uploaded.json() as { item: { imageUrl: string } };
    expect((await SELF.fetch(origin + item.imageUrl)).status).toBe(401);
    const image = await SELF.fetch(origin + item.imageUrl, { headers });
    expect(image.headers.get("Content-Type")).toBe("image/jpeg");
    expect(image.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(jpeg);
    await env.BOSS_MESSAGE_DB.prepare("UPDATE admin_sessions SET mode = 'live'").run();
    expect((await SELF.fetch(url, { headers })).status).toBe(200);
    expect((await SELF.fetch(origin + item.imageUrl, { headers })).status).toBe(200);
    expect((await SELF.fetch(url, { method: "POST", headers, body: form() })).status).toBe(403);
  });
});
