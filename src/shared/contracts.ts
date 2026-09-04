import { z } from "zod";

export const TOPIC_VALUES = [
  "released_hardware",
  "released_software",
  "unreleased_product",
  "appeal",
  "other",
] as const;

export const TOPIC_LABELS: Record<(typeof TOPIC_VALUES)[number], string> = {
  released_hardware: "已发布硬件",
  released_software: "已发布软件",
  unreleased_product: "未发布的新产品",
  appeal: "申冤",
  other: "其他",
};

export const topicSchema = z.enum(TOPIC_VALUES, { message: "请选择留言主题" });

export const phoneSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, "").replace(/^\+?86/, ""))
  .pipe(z.string().regex(/^1[3-9]\d{9}$/, "请输入正确的中国大陆手机号"));

export const nicknameSchema = z
  .string()
  .trim()
  .min(1, "请填写抖音昵称")
  .max(40, "抖音昵称不能超过 40 个字符")
  .transform((value) => value.normalize("NFC"));

export const feedbackFieldsSchema = z
  .object({
    submissionKey: z.string().uuid("提交标识无效"),
    topic: topicSchema,
    customTopic: z.string().trim().max(60, "留言主题不能超过 60 个字符").nullable(),
    content: z
      .string()
      .trim()
      .min(1, "请填写留言内容")
      .max(2000, "留言内容不能超过 2000 个字符"),
    nickname: nicknameSchema,
    privacyAgreed: z.literal(true, { message: "请阅读并同意隐私政策" }),
    livestreamAgreed: z.literal(true, { message: "请确认直播公开展示说明" }),
  })
  .superRefine((value, context) => {
    if (value.topic === "other" && !value.customTopic?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["customTopic"],
        message: "请填写留言主题",
      });
    }
    if (value.topic !== "other" && value.customTopic !== null) {
      context.addIssue({
        code: "custom",
        path: ["customTopic"],
        message: "当前主题不需要自定义内容",
      });
    }
  });

export const otpRequestSchema = z.object({
  phone: phoneSchema,
  nickname: nicknameSchema,
  turnstileToken: z.string().min(1, "请先完成人机验证").max(2048),
});

export const feedbackSubmissionSchema = feedbackFieldsSchema.and(z.object({
  turnstileToken: z.string().min(1, "请先完成人机验证").max(2048),
}));

export const historyQuerySchema = z.object({
  nickname: nicknameSchema,
});

export type Topic = (typeof TOPIC_VALUES)[number];
export type FeedbackFields = z.infer<typeof feedbackFieldsSchema>;
export type OtpRequest = z.infer<typeof otpRequestSchema>;
export type FeedbackSubmission = z.infer<typeof feedbackSubmissionSchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "TURNSTILE_FAILED"
  | "NICKNAME_MISMATCH"
  | "OTP_COOLDOWN"
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "OTP_ATTEMPTS_EXCEEDED"
  | "RATE_LIMITED"
  | "IMAGE_INVALID"
  | "SMS_UNAVAILABLE"
  | "SUBMISSION_FAILED"
  | "HISTORY_NOT_FOUND"
  | "AUTH_FAILED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "SERVER_ERROR";

export interface ApiErrorBody {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
    fieldErrors?: Record<string, string>;
    retryAfterSeconds?: number;
  };
}

export interface PublicConfig {
  turnstileSiteKey: string;
  privacyPolicyVersion: string;
  livestreamPolicyVersion: string;
}

export interface OtpRequestSuccess {
  ok: true;
  challengeId: string;
  maskedPhone: string;
  expiresAt: number;
  cooldownEndsAt: number;
  serverNow: number;
}

export interface SubmitSuccess {
  ok: true;
  feedbackId: string;
  createdAt: number;
  idempotent: boolean;
}

export interface PublicReply {
  id: string;
  replyType: "live" | "message";
  content: string;
  createdAt: number;
}

export interface PublicFeedback {
  id: string;
  topic: Topic;
  customTopic: string | null;
  content: string;
  imageCount: number;
  status: "unreplied" | "replied" | "filtered";
  replies: PublicReply[];
  /** @deprecated Use replies. Kept for a compatible public API transition. */
  replyContent: string | null;
  createdAt: number;
}

export interface HistorySuccess {
  ok: true;
  items: PublicFeedback[];
}
