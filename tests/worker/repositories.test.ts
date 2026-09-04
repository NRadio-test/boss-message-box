import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { D1FeedbackRepository, D1OtpRepository } from "../../worker/infra/d1-repositories";

const PHONE_HASH = "test-phone-hmac-not-a-phone";

function feedbackInput(input: {
  now: number;
  nickname?: string;
  submissionKey?: string;
  id?: string;
}) {
  return {
    id: input.id ?? crypto.randomUUID(),
    submissionKey: input.submissionKey ?? crypto.randomUUID(),
    nickname: input.nickname ?? "测试昵称",
    beijingDay: "2026-09-04",
    topic: "appeal" as const,
    customTopic: null,
    content: "完整留言",
    privacyPolicyVersion: "2026-09-03",
    privacyAgreedAt: input.now,
    livestreamPolicyVersion: "2026-09-03",
    livestreamAgreedAt: input.now,
    images: [],
    now: input.now,
  };
}

async function seedChallenge(challengeId: string, now: number): Promise<void> {
  await env.BOSS_MESSAGE_DB
    .prepare(
      `INSERT INTO otp_challenges
       (id, phone_hash, code_mac, nonce, sent_at, expires_at, attempt_count, consumed_at, invalidated_at, created_at)
       VALUES (?, ?, 'mac', 'nonce', ?, ?, 0, NULL, NULL, ?)`,
    )
    .bind(challengeId, PHONE_HASH, now, now + 300_000, now)
    .run();
}

describe("D1 feedback repository", () => {
  beforeEach(async () => {
    await env.BOSS_MESSAGE_DB.batch([
      env.BOSS_MESSAGE_DB.prepare("DELETE FROM feedback_replies"),
      env.BOSS_MESSAGE_DB.prepare("DELETE FROM feedback_images"),
      env.BOSS_MESSAGE_DB.prepare("DELETE FROM feedback"),
      env.BOSS_MESSAGE_DB.prepare("DELETE FROM nickname_daily_limits"),
    ]);
  });

  it("creates nickname-only feedback and stores a processed image larger than 2 MiB", async () => {
    const now = Date.now();
    const repository = new D1FeedbackRepository(env.BOSS_MESSAGE_DB);
    const input = feedbackInput({ now });

    const result = await repository.create({
      ...input,
      images: [
        {
          id: crypto.randomUUID(),
          objectKey: `feedback-images/${input.id}/large.webp`,
          mediaType: "image/webp",
          byteSize: 2 * 1024 * 1024 + 1,
          width: 2560,
          height: 1440,
          sha256: "large-processed-image-sha256",
        },
      ],
    });

    expect(result.status).toBe("created");
    expect(
      await env.BOSS_MESSAGE_DB
        .prepare("SELECT user_id, douyin_nickname FROM feedback WHERE id = ?")
        .bind(input.id)
        .first<{ user_id: string | null; douyin_nickname: string }>(),
    ).toEqual({ user_id: null, douyin_nickname: "测试昵称" });
    expect(
      await env.BOSS_MESSAGE_DB
        .prepare("SELECT byte_size FROM feedback_images WHERE feedback_id = ?")
        .bind(input.id)
        .first<{ byte_size: number }>(),
    ).toEqual({ byte_size: 2 * 1024 * 1024 + 1 });
  });

  it("allows ten successful submissions per exact nickname and rejects the eleventh atomically", async () => {
    const now = Date.now();
    const repository = new D1FeedbackRepository(env.BOSS_MESSAGE_DB);

    for (let index = 0; index < 10; index += 1) {
      await expect(repository.create(feedbackInput({ now: now + index }))).resolves.toMatchObject({
        status: "created",
      });
    }
    await expect(repository.create(feedbackInput({ now: now + 10 }))).resolves.toEqual({
      status: "daily_limit",
    });
    expect(
      await env.BOSS_MESSAGE_DB
        .prepare("SELECT COUNT(*) AS count FROM feedback WHERE douyin_nickname = ?")
        .bind("测试昵称")
        .first<{ count: number }>(),
    ).toEqual({ count: 10 });
    expect(
      await env.BOSS_MESSAGE_DB
        .prepare("SELECT submission_count FROM nickname_daily_limits WHERE nickname = ?")
        .bind("测试昵称")
        .first<{ submission_count: number }>(),
    ).toEqual({ submission_count: 10 });

    await expect(repository.create({
      ...feedbackInput({ now: now + 86_400_000 }),
      beijingDay: "2026-09-05",
    })).resolves.toMatchObject({ status: "created" });
  });

  it("treats different case as a different exact nickname", async () => {
    const now = Date.now();
    const repository = new D1FeedbackRepository(env.BOSS_MESSAGE_DB);

    await repository.create(feedbackInput({ now, nickname: "ZhangDao" }));
    await repository.create(feedbackInput({ now: now + 1, nickname: "zhangdao" }));

    expect((await repository.findHistory("ZhangDao"))?.length).toBe(1);
    expect((await repository.findHistory("zhangdao"))?.length).toBe(1);
    expect(await repository.findHistory("ZHANGDAO")).toBeNull();
  });

  it("shows a filtered item in public history and keeps its replies visible", async () => {
    const now = Date.now();
    const repository = new D1FeedbackRepository(env.BOSS_MESSAGE_DB);
    const feedbackId = crypto.randomUUID();
    await repository.create(feedbackInput({ now, id: feedbackId }));
    await repository.setModerationResult({
      feedbackId,
      status: "filtered",
      category: "abusive",
      reason: "包含辱骂内容",
      now: now + 1,
    });
    await env.BOSS_MESSAGE_DB
      .prepare(
        `INSERT INTO feedback_replies
          (id, feedback_id, reply_type, content, admin_id, created_at)
         VALUES ('public-reply', ?, 'message', '已处理', NULL, ?)`,
      )
      .bind(feedbackId, now + 2)
      .run();

    expect((await repository.findHistory("测试昵称"))?.[0]).toMatchObject({
      id: feedbackId,
      status: "filtered",
      replyContent: "已处理",
      replies: [{ id: "public-reply", content: "已处理" }],
    });
  });
});

describe("dormant D1 OTP protections", () => {
  beforeEach(async () => {
    await env.BOSS_MESSAGE_DB.batch([
      env.BOSS_MESSAGE_DB.prepare("DELETE FROM otp_phone_state"),
      env.BOSS_MESSAGE_DB.prepare("DELETE FROM otp_challenges"),
    ]);
  });

  it("keeps the existing 120 second send cooldown available for a future re-enable", async () => {
    const repository = new D1OtpRepository(env.BOSS_MESSAGE_DB);
    const now = 1_800_000_000_000;
    const firstLease = crypto.randomUUID();
    expect(
      await repository.reserveSend({
        phoneHash: PHONE_HASH,
        leaseToken: firstLease,
        now,
        leaseSeconds: 120,
        cooldownSeconds: 120,
      }),
    ).toEqual({ reserved: true });

    await repository.commitSent({
      challengeId: crypto.randomUUID(),
      phoneHash: PHONE_HASH,
      leaseToken: firstLease,
      codeMac: "mac",
      nonce: "nonce",
      now,
      expiresAt: now + 300_000,
    });

    expect(
      await repository.reserveSend({
        phoneHash: PHONE_HASH,
        leaseToken: crypto.randomUUID(),
        now: now + 119_000,
        leaseSeconds: 120,
        cooldownSeconds: 120,
      }),
    ).toEqual({ reserved: false, retryAfterSeconds: 1 });
  });

  it("invalidates a dormant OTP on the sixth wrong attempt", async () => {
    const repository = new D1OtpRepository(env.BOSS_MESSAGE_DB);
    const now = 1_800_000_000_000;
    const challengeId = crypto.randomUUID();
    await seedChallenge(challengeId, now);

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      expect(await repository.recordFailedAttempt(challengeId, now + attempt)).toBe(attempt);
    }
    expect(await repository.findChallenge(challengeId, PHONE_HASH)).toMatchObject({
      attemptCount: 6,
      invalidatedAt: now + 6,
    });
  });
});
