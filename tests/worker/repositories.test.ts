import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { D1FeedbackRepository, D1OtpRepository } from "../../worker/infra/d1-repositories";

const PHONE_HASH = "test-phone-hmac-not-a-phone";

function feedbackInput(input: {
  challengeId: string;
  now: number;
  nickname?: string;
  submissionKey?: string;
}) {
  return {
    id: crypto.randomUUID(),
    submissionKey: input.submissionKey ?? crypto.randomUUID(),
    userId: crypto.randomUUID(),
    phoneHash: PHONE_HASH,
    phoneEncrypted: "v1.iv.ciphertext",
    nickname: input.nickname ?? "测试昵称",
    topic: "appeal" as const,
    customTopic: null,
    content: "完整留言",
    privacyPolicyVersion: "2026-09-03",
    privacyAgreedAt: input.now,
    livestreamPolicyVersion: "2026-09-03",
    livestreamAgreedAt: input.now,
    challengeId: input.challengeId,
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
      env.BOSS_MESSAGE_DB.prepare("DELETE FROM feedback_images"),
      env.BOSS_MESSAGE_DB.prepare("DELETE FROM feedback"),
      env.BOSS_MESSAGE_DB.prepare("DELETE FROM users"),
      env.BOSS_MESSAGE_DB.prepare("DELETE FROM otp_challenges"),
    ]);
  });

  it("atomically creates a first user, feedback and consumes OTP", async () => {
    const now = Date.now();
    const challengeId = crypto.randomUUID();
    await seedChallenge(challengeId, now);
    const repository = new D1FeedbackRepository(env.BOSS_MESSAGE_DB);
    const result = await repository.createWithUserAndConsumeOtp({
      id: crypto.randomUUID(),
      submissionKey: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      phoneHash: PHONE_HASH,
      phoneEncrypted: "v1.iv.ciphertext",
      nickname: "测试昵称",
      topic: "other",
      customTopic: "其他主题",
      content: "完整留言",
      privacyPolicyVersion: "2026-09-03",
      privacyAgreedAt: now,
      livestreamPolicyVersion: "2026-09-03",
      livestreamAgreedAt: now,
      challengeId,
      images: [],
      now,
    });
    expect(result.status).toBe("created");
    expect((await env.BOSS_MESSAGE_DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>())?.count).toBe(1);
    expect((await env.BOSS_MESSAGE_DB.prepare("SELECT COUNT(*) AS count FROM feedback").first<{ count: number }>())?.count).toBe(1);
    expect((await env.BOSS_MESSAGE_DB.prepare("SELECT consumed_at FROM otp_challenges WHERE id = ?").bind(challengeId).first<{ consumed_at: number }>())?.consumed_at).toBe(now);
  });

  it("lets an existing phone submit again with the same nickname without duplicating the user", async () => {
    const repository = new D1FeedbackRepository(env.BOSS_MESSAGE_DB);
    const now = Date.now();
    const firstChallengeId = crypto.randomUUID();
    const secondChallengeId = crypto.randomUUID();
    await seedChallenge(firstChallengeId, now);
    await seedChallenge(secondChallengeId, now + 1_000);

    const first = await repository.createWithUserAndConsumeOtp(
      feedbackInput({ challengeId: firstChallengeId, now }),
    );
    const second = await repository.createWithUserAndConsumeOtp(
      feedbackInput({ challengeId: secondChallengeId, now: now + 1_000 }),
    );

    expect(first.status).toBe("created");
    expect(second.status).toBe("created");
    expect(
      (await env.BOSS_MESSAGE_DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>())
        ?.count,
    ).toBe(1);
    expect(
      (await env.BOSS_MESSAGE_DB.prepare("SELECT COUNT(*) AS count FROM feedback").first<{ count: number }>())
        ?.count,
    ).toBe(2);
    const challenges = await env.BOSS_MESSAGE_DB
      .prepare("SELECT id, consumed_at FROM otp_challenges ORDER BY created_at")
      .all<{ id: string; consumed_at: number | null }>();
    expect(challenges.results).toEqual([
      { id: firstChallengeId, consumed_at: now },
      { id: secondChallengeId, consumed_at: now + 1_000 },
    ]);
  });

  it("rejects a different nickname for an existing phone and leaves the OTP usable", async () => {
    const repository = new D1FeedbackRepository(env.BOSS_MESSAGE_DB);
    const now = Date.now();
    const firstChallengeId = crypto.randomUUID();
    const mismatchChallengeId = crypto.randomUUID();
    await seedChallenge(firstChallengeId, now);
    await seedChallenge(mismatchChallengeId, now + 1_000);
    await repository.createWithUserAndConsumeOtp(
      feedbackInput({ challengeId: firstChallengeId, now }),
    );

    const mismatch = await repository.createWithUserAndConsumeOtp(
      feedbackInput({
        challengeId: mismatchChallengeId,
        now: now + 1_000,
        nickname: "另一个昵称",
      }),
    );

    expect(mismatch).toEqual({ status: "nickname_mismatch" });
    expect(
      (await env.BOSS_MESSAGE_DB.prepare("SELECT COUNT(*) AS count FROM feedback").first<{ count: number }>())
        ?.count,
    ).toBe(1);
    expect(
      (
        await env.BOSS_MESSAGE_DB
          .prepare("SELECT consumed_at FROM otp_challenges WHERE id = ?")
          .bind(mismatchChallengeId)
          .first<{ consumed_at: number | null }>()
      )?.consumed_at,
    ).toBeNull();
  });

  it("maps internal reply states to the only two public states", async () => {
    const now = Date.now();
    const challengeId = crypto.randomUUID();
    await seedChallenge(challengeId, now);
    const repository = new D1FeedbackRepository(env.BOSS_MESSAGE_DB);
    const feedbackId = crypto.randomUUID();
    await repository.createWithUserAndConsumeOtp({
      id: feedbackId,
      submissionKey: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      phoneHash: PHONE_HASH,
      phoneEncrypted: "v1.iv.ciphertext",
      nickname: "测试昵称",
      topic: "appeal",
      customTopic: null,
      content: "需要回复",
      privacyPolicyVersion: "v1",
      privacyAgreedAt: now,
      livestreamPolicyVersion: "v1",
      livestreamAgreedAt: now,
      challengeId,
      images: [],
      now,
    });
    expect((await repository.findHistory(PHONE_HASH, "测试昵称"))?.[0]?.status).toBe("unreplied");
    await env.BOSS_MESSAGE_DB
      .prepare("UPDATE feedback SET internal_status = 'message_replied', reply_type = 'message', reply_content = '已处理' WHERE id = ?")
      .bind(feedbackId)
      .run();
    const history = await repository.findHistory(PHONE_HASH, "测试昵称");
    expect(history?.[0]).toMatchObject({ status: "replied", replyContent: "已处理" });
    expect(await repository.findHistory(PHONE_HASH, "错误昵称")).toBeNull();
  });

  it("database constraints reject replied state without reply content", async () => {
    const now = Date.now();
    const challengeId = crypto.randomUUID();
    await seedChallenge(challengeId, now);
    const repository = new D1FeedbackRepository(env.BOSS_MESSAGE_DB);
    const feedbackId = crypto.randomUUID();
    await repository.createWithUserAndConsumeOtp({
      id: feedbackId,
      submissionKey: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      phoneHash: PHONE_HASH,
      phoneEncrypted: "v1.iv.ciphertext",
      nickname: "测试昵称",
      topic: "appeal",
      customTopic: null,
      content: "约束测试",
      privacyPolicyVersion: "v1",
      privacyAgreedAt: now,
      livestreamPolicyVersion: "v1",
      livestreamAgreedAt: now,
      challengeId,
      images: [],
      now,
    });
    await expect(
      env.BOSS_MESSAGE_DB
        .prepare("UPDATE feedback SET internal_status = 'message_replied', reply_type = 'message', reply_content = NULL WHERE id = ?")
        .bind(feedbackId)
        .run(),
    ).rejects.toThrow();
  });
});

describe("D1 OTP cooldown", () => {
  beforeEach(async () => {
    await env.BOSS_MESSAGE_DB.batch([
      env.BOSS_MESSAGE_DB.prepare("DELETE FROM otp_phone_state"),
      env.BOSS_MESSAGE_DB.prepare("DELETE FROM otp_challenges"),
    ]);
  });

  it("keeps the 120 second send cooldown after a successful verification flow", async () => {
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

    const challengeId = crypto.randomUUID();
    await repository.commitSent({
      challengeId,
      phoneHash: PHONE_HASH,
      leaseToken: firstLease,
      codeMac: "mac",
      nonce: "nonce",
      now,
      expiresAt: now + 300_000,
    });
    await env.BOSS_MESSAGE_DB
      .prepare("UPDATE otp_challenges SET consumed_at = ? WHERE id = ?")
      .bind(now + 1_000, challengeId)
      .run();

    const blocked = await repository.reserveSend({
      phoneHash: PHONE_HASH,
      leaseToken: crypto.randomUUID(),
      now: now + 119_000,
      leaseSeconds: 120,
      cooldownSeconds: 120,
    });
    expect(blocked).toEqual({ reserved: false, retryAfterSeconds: 1 });

    expect(
      await repository.reserveSend({
        phoneHash: PHONE_HASH,
        leaseToken: crypto.randomUUID(),
        now: now + 120_000,
        leaseSeconds: 120,
        cooldownSeconds: 120,
      }),
    ).toEqual({ reserved: true });
  });

  it("invalidates an OTP on the sixth wrong attempt and never increments beyond six", async () => {
    const repository = new D1OtpRepository(env.BOSS_MESSAGE_DB);
    const now = 1_800_000_000_000;
    const challengeId = crypto.randomUUID();
    await seedChallenge(challengeId, now);

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      expect(await repository.recordFailedAttempt(challengeId, now + attempt)).toBe(attempt);
    }
    expect(await repository.recordFailedAttempt(challengeId, now + 7)).toBe(6);
    expect(await repository.findChallenge(challengeId, PHONE_HASH)).toMatchObject({
      attemptCount: 6,
      invalidatedAt: now + 6,
    });
  });
});
