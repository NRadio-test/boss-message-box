import { describe, expect, it } from "vitest";
import {
  feedbackFieldsSchema,
  historyQuerySchema,
  phoneSchema,
  TOPIC_VALUES,
} from "../../src/shared/contracts";
import {
  studioLoginSchema,
  studioReplyCreateSchema,
  studioSearchSchema,
} from "../../src/shared/studio-contracts";

const base = {
  submissionKey: "2e7aa396-82af-4a10-b1d0-69cd587df44f",
  customTopic: null,
  content: "产品在使用中偶尔断开连接。",
  nickname: "测试观众",
  privacyAgreed: true,
  livestreamAgreed: true,
} as const;

describe("shared validation", () => {
  it("accepts every fixed topic without a custom topic", () => {
    for (const topic of TOPIC_VALUES.filter((value) => value !== "other")) {
      expect(feedbackFieldsSchema.safeParse({ ...base, topic }).success).toBe(true);
    }
  });

  it("reveals a required custom topic only for other", () => {
    expect(feedbackFieldsSchema.safeParse({ ...base, topic: "other", customTopic: "售后体验" }).success).toBe(true);
    expect(feedbackFieldsSchema.safeParse({ ...base, topic: "other", customTopic: "" }).success).toBe(false);
    expect(feedbackFieldsSchema.safeParse({ ...base, topic: "appeal", customTopic: "不应存在" }).success).toBe(false);
  });

  it("enforces the 2000-character boundary", () => {
    expect(feedbackFieldsSchema.safeParse({ ...base, topic: "appeal", content: "字".repeat(2000) }).success).toBe(true);
    expect(feedbackFieldsSchema.safeParse({ ...base, topic: "appeal", content: "字".repeat(2001) }).success).toBe(false);
  });

  it("normalizes nicknames for exact history lookup while keeping dormant phone validation intact", () => {
    expect(phoneSchema.parse("+86 138-0013-8000")).toBe("13800138000");
    expect(phoneSchema.safeParse("85366123456").success).toBe(false);
    expect(historyQuerySchema.parse({ nickname: " 昵称 " })).toEqual({ nickname: "昵称" });
    expect(historyQuerySchema.parse({ nickname: "ZhangDao" }).nickname).not.toBe("zhangdao");
  });

  it("validates Studio credentials, search input, and the 2000-character reply boundary", () => {
    expect(studioLoginSchema.parse({ username: " ZD ", password: "admin" }).username).toBe("zd");
    expect(studioSearchSchema.safeParse({ query: "13906325777", page: 1 }).success).toBe(true);
    expect(studioReplyCreateSchema.safeParse({ replyType: "message", content: "字".repeat(2000) }).success).toBe(true);
    expect(studioReplyCreateSchema.safeParse({ replyType: "live", content: "字".repeat(2001) }).success).toBe(false);
  });
});
