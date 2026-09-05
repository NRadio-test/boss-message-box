import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { D1StudioRepository } from "../../worker/infra/d1-studio-repositories";

const USER_ID = "studio-test-user";
const ADMIN_ZD = { id: "admin-zd", username: "zd" };
const ADMIN_FA = { id: "admin-fa", username: "fa" };

async function seedUser(): Promise<void> {
  await env.BOSS_MESSAGE_DB
    .prepare(
      `INSERT INTO users
        (id, phone_encrypted, phone_hash, douyin_nickname, created_at, updated_at)
       VALUES (?, 'encrypted-phone', 'studio-phone-hash', '测试昵称', 1000, 1000)`,
    )
    .bind(USER_ID)
    .run();
}

async function seedFeedback(input: {
  id: string;
  createdAt: number;
  isTodo?: boolean;
  moderationStatus?: "pending" | "kept" | "filtered" | "failed";
  topic?: "released_hardware" | "released_software" | "unreleased_product" | "appeal" | "other";
}): Promise<void> {
  await env.BOSS_MESSAGE_DB
    .prepare(
      `INSERT INTO feedback
        (id, submission_key, user_id, douyin_nickname, topic, custom_topic, content, internal_status,
         reply_type, reply_content, privacy_policy_version, privacy_agreed_at,
         livestream_policy_version, livestream_agreed_at, moderation_status,
         created_at, updated_at, is_todo)
       VALUES (?, ?, ?, '测试昵称', ?, NULL, ?, 'unprocessed', NULL, NULL,
               'v1', ?, 'v1', ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      `submission-${input.id}`,
      USER_ID,
      input.topic ?? "appeal",
      `留言 ${input.id}`,
      input.createdAt,
      input.createdAt,
      input.moderationStatus ?? "kept",
      input.createdAt,
      input.createdAt,
      input.isTodo ? 1 : 0,
    )
    .run();
}

async function seedReply(input: {
  id: string;
  feedbackId: string;
  type: "live" | "message";
  adminId: string;
  createdAt: number;
}): Promise<void> {
  await env.BOSS_MESSAGE_DB
    .prepare(
      `INSERT INTO feedback_replies
        (id, feedback_id, reply_type, content, admin_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.feedbackId,
      input.type,
      `回复 ${input.id}`,
      input.adminId,
      input.createdAt,
    )
    .run();
}

describe("D1 Studio repository", () => {
  beforeEach(async () => {
    await env.BOSS_MESSAGE_DB.batch([
      env.BOSS_MESSAGE_DB.prepare("DELETE FROM audit_logs"),
      env.BOSS_MESSAGE_DB.prepare("DELETE FROM feedback_replies"),
      env.BOSS_MESSAGE_DB.prepare("DELETE FROM feedback_images"),
      env.BOSS_MESSAGE_DB.prepare("DELETE FROM feedback"),
      env.BOSS_MESSAGE_DB.prepare("DELETE FROM users"),
      env.BOSS_MESSAGE_DB.prepare("DELETE FROM admin_sessions"),
    ]);
    await seedUser();
  });

  it("uses reply existence for filters and keeps an unreplied todo in both lists", async () => {
    await seedFeedback({ id: "10000001-feedback", createdAt: 1_001 });
    await seedFeedback({ id: "10000002-feedback", createdAt: 1_002 });
    await seedFeedback({ id: "10000003-feedback", createdAt: 1_003 });
    await seedFeedback({ id: "10000004-feedback", createdAt: 1_004, isTodo: true });
    await seedFeedback({ id: "10000005-feedback", createdAt: 1_005, isTodo: true, moderationStatus: "filtered" });
    await seedReply({
      id: "both-live",
      feedbackId: "10000001-feedback",
      type: "live",
      adminId: ADMIN_ZD.id,
      createdAt: 2_001,
    });
    await seedReply({
      id: "both-message",
      feedbackId: "10000001-feedback",
      type: "message",
      adminId: ADMIN_FA.id,
      createdAt: 2_002,
    });
    await seedReply({
      id: "live-only",
      feedbackId: "10000002-feedback",
      type: "live",
      adminId: ADMIN_ZD.id,
      createdAt: 2_003,
    });
    await seedReply({
      id: "message-only",
      feedbackId: "10000003-feedback",
      type: "message",
      adminId: ADMIN_FA.id,
      createdAt: 2_004,
    });

    const repository = new D1StudioRepository(env.BOSS_MESSAGE_DB);
    const list = (view: "unreplied" | "replied" | "live" | "message" | "todo") =>
      repository.listFeedbacks({ view, topic: null, page: 1, snapshot: null });

    expect((await list("unreplied")).items.map((item) => item.id)).toEqual(["10000004-feedback"]);
    expect((await list("todo")).items.map((item) => item.id)).toEqual(["10000004-feedback"]);
    expect((await list("replied")).items.map((item) => item.id)).toEqual([
      "10000003-feedback",
      "10000002-feedback",
      "10000001-feedback",
    ]);
    expect((await list("live")).items.map((item) => item.id)).toEqual([
      "10000002-feedback",
      "10000001-feedback",
    ]);
    expect((await list("message")).items.map((item) => item.id)).toEqual([
      "10000003-feedback",
      "10000001-feedback",
    ]);
    expect((await repository.listFeedbacks({ view: "filtered", topic: null, page: 1, snapshot: null })).items.map((item) => item.id)).toEqual([
      "10000005-feedback",
    ]);
    await seedFeedback({ id: "10000006-feedback", createdAt: 1_006 });
    expect(await repository.findNextFeedback({
      currentFeedbackId: "10000006-feedback",
      view: "unreplied",
      topic: null,
    })).toBe("10000004-feedback");
    expect((await repository.getFeedbackSummary("10000001-feedback"))).toMatchObject({
      status: "replied",
      replyCount: 2,
      latestReplyAdmin: "fa",
      isTodo: false,
    });
  });

  it("appends concurrent replies without lost updates and clears todo", async () => {
    const feedbackId = "20000001-feedback";
    await seedFeedback({ id: feedbackId, createdAt: 3_000, isTodo: true });
    const repository = new D1StudioRepository(env.BOSS_MESSAGE_DB);

    const results = await Promise.all([
      repository.appendReply({
        id: "reply-zd",
        feedbackId,
        replyType: "live",
        content: "直播回复",
        admin: ADMIN_ZD,
        now: 4_000,
      }),
      repository.appendReply({
        id: "reply-fa",
        feedbackId,
        replyType: "message",
        content: "留言回复",
        admin: ADMIN_FA,
        now: 4_001,
      }),
    ]);

    expect(results.every(Boolean)).toBe(true);
    const detail = await repository.findFeedback(feedbackId);
    expect(detail?.replies.map((reply) => reply.id)).toEqual(["reply-zd", "reply-fa"]);
    expect(detail).toMatchObject({ status: "replied", replyCount: 2, isTodo: false });
    expect(
      (await env.BOSS_MESSAGE_DB
        .prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE feedback_id = ? AND action = 'reply_created'")
        .bind(feedbackId)
        .first<{ count: number }>())?.count,
    ).toBe(2);
  });

  it("cannot re-add todo when it races with an appended reply", async () => {
    const feedbackId = "30000001-feedback";
    await seedFeedback({ id: feedbackId, createdAt: 5_000 });
    const repository = new D1StudioRepository(env.BOSS_MESSAGE_DB);

    await Promise.all([
      repository.setTodo({ feedbackId, isTodo: true, adminId: ADMIN_ZD.id, now: 6_000 }),
      repository.appendReply({
        id: "race-reply",
        feedbackId,
        replyType: "message",
        content: "并发回复",
        admin: ADMIN_FA,
        now: 6_001,
      }),
    ]);

    expect(await repository.getFeedbackSummary(feedbackId)).toMatchObject({
      status: "replied",
      replyCount: 1,
      isTodo: false,
    });
    expect(
      (await env.BOSS_MESSAGE_DB
        .prepare("SELECT is_todo FROM feedback WHERE id = ?")
        .bind(feedbackId)
        .first<{ is_todo: number }>())?.is_todo,
    ).toBe(0);
  });

  it("keeps 30-item pages stable and supports the three search forms", async () => {
    for (let index = 0; index < 31; index += 1) {
      await seedFeedback({
        id: `${index.toString(16).padStart(8, "0")}-feedback`,
        createdAt: 10_000 + index,
      });
    }
    const repository = new D1StudioRepository(env.BOSS_MESSAGE_DB);
    const firstPage = await repository.listFeedbacks({ view: "unreplied", topic: null, page: 1, snapshot: null });
    expect(firstPage.items).toHaveLength(30);
    expect(firstPage.items[0]?.id).toBe("0000001e-feedback");
    expect(firstPage.pagination).toMatchObject({ pageSize: 30, total: 31, totalPages: 2 });

    await seedFeedback({ id: "ffffffff-feedback", createdAt: 20_000, topic: "released_software" });
    const secondPage = await repository.listFeedbacks({
      view: "unreplied",
      topic: null,
      page: 2,
      snapshot: firstPage.snapshot,
    });
    expect(secondPage.items.map((item) => item.id)).toEqual(["00000000-feedback"]);
    expect(await repository.countNewFeedback(firstPage.snapshot!, null)).toBe(1);
    expect(await repository.countNewFeedback(firstPage.snapshot!, "appeal")).toBe(0);
    expect(await repository.countNewFeedback(firstPage.snapshot!, "released_software")).toBe(1);
    expect((await repository.listFeedbacks({
      view: "unreplied",
      topic: "released_software",
      page: 1,
      snapshot: null,
    })).items.map((item) => item.id)).toEqual(["ffffffff-feedback"]);

    expect((await repository.searchFeedbacks({
      queryType: "phone",
      queryValue: "studio-phone-hash",
      page: 1,
      snapshot: null,
    })).pagination.total).toBe(32);
    expect((await repository.searchFeedbacks({
      queryType: "feedback_number",
      queryValue: "0000001E",
      page: 1,
      snapshot: null,
    })).items.map((item) => item.id)).toEqual(["0000001e-feedback"]);
    expect((await repository.searchFeedbacks({
      queryType: "nickname",
      queryValue: "测试昵称",
      page: 1,
      snapshot: null,
    })).pagination.total).toBe(32);
  });

  it("deduplicates a reply request and rejects reuse with different content", async () => {
    const feedbackId = "70000001-feedback";
    await seedFeedback({ id: feedbackId, createdAt: 20_000, moderationStatus: "pending" });
    const repository = new D1StudioRepository(env.BOSS_MESSAGE_DB);
    const input = { feedbackId, requestKey: crypto.randomUUID(), replyType: "message" as const, content: "保存一次", admin: ADMIN_ZD, now: 21_000 };
    const results = await Promise.all([
      repository.appendReply({ ...input, id: "first-request" }),
      repository.appendReply({ ...input, id: "retry-request" }),
    ]);
    expect(results[0]?.reply.id).toBe(results[1]?.reply.id);
    expect(await repository.findFeedback(feedbackId)).toMatchObject({ replyCount: 1, moderationStatus: "kept" });
    expect(await env.BOSS_MESSAGE_DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE feedback_id = ?").bind(feedbackId).first()).toMatchObject({ n: 1 });
    await expect(repository.appendReply({ ...input, id: "changed-request", content: "不同内容" })).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
  });

  it("skips pending/filtered records in the live queue and atomically rejects a pending live reply", async () => {
    await seedFeedback({ id: "80000004-feedback", createdAt: 4 });
    await seedFeedback({ id: "80000003-feedback", createdAt: 3, moderationStatus: "pending" });
    await seedFeedback({ id: "80000002-feedback", createdAt: 2, moderationStatus: "filtered" });
    await seedFeedback({ id: "80000001-feedback", createdAt: 1, moderationStatus: "failed" });
    const repository = new D1StudioRepository(env.BOSS_MESSAGE_DB);
    expect(await repository.findNextFeedback({ currentFeedbackId: "80000004-feedback", view: "unreplied", topic: null })).toBe("80000001-feedback");
    expect((await repository.listFeedbacks({ view: "unreplied", page: 1, topic: null, snapshot: null, readyOnly: true })).items.map((item) => item.id)).toEqual(["80000004-feedback", "80000001-feedback"]);
    await expect(repository.appendReply({ id: "blocked-reply", feedbackId: "80000003-feedback", liveMode: true, replyType: "live", content: "不能提前展示", admin: ADMIN_ZD, now: 5 })).rejects.toMatchObject({ code: "FEEDBACK_NOT_READY" });
  });

  it("searches numeric/hex nicknames and receipt numbers together", async () => {
    await seedFeedback({ id: "deadbeef-feedback", createdAt: 2 });
    await seedFeedback({ id: "90000001-feedback", createdAt: 1 });
    await env.BOSS_MESSAGE_DB.prepare("UPDATE feedback SET douyin_nickname = 'deadbeef' WHERE id = '90000001-feedback'").run();
    const repository = new D1StudioRepository(env.BOSS_MESSAGE_DB);
    expect((await repository.searchFeedbacks({ queryType: "combined", queryValue: "deadbeef", page: 1, snapshot: null })).items).toHaveLength(2);
    await env.BOSS_MESSAGE_DB.prepare("UPDATE feedback SET douyin_nickname = '13906325777' WHERE id = '90000001-feedback'").run();
    expect((await repository.searchFeedbacks({ queryType: "combined", queryValue: "13906325777", page: 1, snapshot: null })).items.map((item) => item.id)).toEqual(["90000001-feedback"]);
  });

  it("counts a feedback as replied today even if it already had an older reply", async () => {
    await seedFeedback({ id: "a0000001-feedback", createdAt: 100 });
    await seedReply({ id: "yesterday", feedbackId: "a0000001-feedback", type: "live", adminId: ADMIN_ZD.id, createdAt: 200 });
    await seedReply({ id: "today", feedbackId: "a0000001-feedback", type: "message", adminId: ADMIN_ZD.id, createdAt: 1_000 });
    expect(await new D1StudioRepository(env.BOSS_MESSAGE_DB).getStats(900)).toMatchObject({ todayReplied: 1 });
  });
});
