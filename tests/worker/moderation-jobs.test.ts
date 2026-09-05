import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { D1FeedbackRepository } from "../../worker/infra/d1-repositories";
import { D1ModerationJobRepository, MODERATION_LEASE_MS } from "../../worker/infra/d1-moderation-jobs";
import { D1StudioRepository } from "../../worker/infra/d1-studio-repositories";

const feedback = new D1FeedbackRepository(env.BOSS_MESSAGE_DB);
const jobs = new D1ModerationJobRepository(env.BOSS_MESSAGE_DB);
const studio = new D1StudioRepository(env.BOSS_MESSAGE_DB);
async function seed() {
  const id = crypto.randomUUID();
  await feedback.create({ id, submissionKey: crypto.randomUUID(), nickname: id, beijingDay: "2026-09-05", topic: "appeal", customTopic: null, content: "具体的问题", privacyPolicyVersion: "test", privacyAgreedAt: 1, livestreamPolicyVersion: "test", livestreamAgreedAt: 1, images: [], now: 1 });
  return id;
}

it("leases each AI task once and ignores the result of an expired attempt", async () => {
  const id = await seed();
  const claims = await Promise.all([jobs.claim({ feedbackId: id, now: 100 }), jobs.claim({ feedbackId: id, now: 100 })]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const first = claims.find(Boolean)!;
  const second = (await jobs.claim({ feedbackId: id, now: 100 + MODERATION_LEASE_MS }))!;
  expect(second.attempts).toBe(2);
  await feedback.setModerationResult({ feedbackId: id, attemptToken: first.attemptToken, status: "filtered", category: "abusive", reason: "旧结果", now: 50_000 });
  expect(await studio.getFeedbackSummary(id)).toMatchObject({ moderationStatus: "pending" });
  await feedback.setModerationResult({ feedbackId: id, attemptToken: second.attemptToken, status: "kept", category: "valid_feedback", reason: "有效反馈", now: 50_001 });
  expect(await studio.getFeedbackSummary(id)).toMatchObject({ moderationStatus: "kept" });
});

it("preserves replies and manual decisions when an AI response arrives late", async () => {
  for (const action of ["reply", "manual"] as const) {
    const id = await seed();
    const job = (await jobs.claim({ feedbackId: id, now: 100 }))!;
    if (action === "reply") await studio.appendReply({ id: crypto.randomUUID(), feedbackId: id, replyType: "message", content: "已回复", admin: { id: "admin-zd", username: "zd" }, now: 200 });
    else await studio.setModeration({ feedbackId: id, filtered: false, adminId: "admin-zd", now: 200 });
    await feedback.setModerationResult({ feedbackId: id, attemptToken: job.attemptToken, status: "filtered", category: "abusive", reason: "迟到的结果", now: 300 });
    expect(await studio.getFeedbackSummary(id)).toMatchObject({ moderationStatus: "kept" });
    expect(await jobs.claim({ feedbackId: id, now: 100_000, manual: true })).toBeNull();
  }
});

it("stops automatic retries after three interrupted attempts and permits an explicit retry", async () => {
  const id = await seed();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    expect(await jobs.claim({ feedbackId: id, now: 100 + attempt * MODERATION_LEASE_MS })).toMatchObject({ attempts: attempt + 1 });
  }
  const now = 100 + 3 * MODERATION_LEASE_MS;
  expect(await jobs.claim({ feedbackId: id, now })).toBeNull();
  await jobs.expireExhausted(now);
  expect(await studio.getFeedbackSummary(id)).toMatchObject({ moderationStatus: "failed", moderationReason: "worker_interrupted" });
  expect(await jobs.claim({ feedbackId: id, now, manual: true })).toMatchObject({ attempts: 1 });
  expect(await studio.getFeedbackSummary(id)).toMatchObject({ moderationStatus: "pending" });
});
