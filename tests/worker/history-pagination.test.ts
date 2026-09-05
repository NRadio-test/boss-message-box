import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { D1FeedbackRepository } from "../../worker/infra/d1-repositories";

it("paginates nickname history by timestamp and id without duplicates", async () => {
  const repository = new D1FeedbackRepository(env.BOSS_MESSAGE_DB);
  const nickname = `分页-${crypto.randomUUID().slice(0, 8)}`;
  for (let index = 1; index <= 31; index += 1) {
    await repository.create({
      id: crypto.randomUUID(), submissionKey: crypto.randomUUID(), nickname,
      beijingDay: `2026-08-${String(index).padStart(2, "0")}`,
      topic: "appeal", customTopic: null, content: `分页留言${index}`,
      privacyPolicyVersion: "test", privacyAgreedAt: 1_000,
      livestreamPolicyVersion: "test", livestreamAgreedAt: 1_000,
      images: [], now: 1_000,
    });
  }
  const first = (await repository.findHistory(nickname))!;
  expect(first).toHaveLength(31);
  const cursor = { id: first[29]!.id, createdAt: first[29]!.createdAt };
  const second = (await repository.findHistory(nickname, cursor))!;
  expect(second).toHaveLength(1);
  expect(new Set([...first.slice(0, 30), ...second].map((item) => item.id)).size).toBe(31);
  expect(second[0]!.id).toBe(first[30]!.id);
  expect(await repository.findHistory(nickname, { id: second[0]!.id, createdAt: second[0]!.createdAt })).toBeNull();
});
