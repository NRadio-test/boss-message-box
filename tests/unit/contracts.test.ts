import { describe, expect, it } from "vitest";
import {
  feedbackFieldsSchema,
  historyQuerySchema,
  phoneSchema,
  TOPIC_VALUES,
} from "../../src/shared/contracts";

const base = {
  submissionKey: "2e7aa396-82af-4a10-b1d0-69cd587df44f",
  customTopic: null,
  content: "产品在使用中偶尔断开连接。",
  nickname: "测试观众",
  phone: "13800138000",
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

  it("normalizes +86 numbers and rejects non-mainland formats", () => {
    expect(phoneSchema.parse("+86 138-0013-8000")).toBe("13800138000");
    expect(phoneSchema.safeParse("85366123456").success).toBe(false);
    expect(historyQuerySchema.safeParse({ phone: "13800138000", nickname: " 昵称 " }).success).toBe(true);
  });
});
