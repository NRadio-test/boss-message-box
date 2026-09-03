import { z } from "zod";
import type { Topic } from "./contracts";

export const STUDIO_PAGE_SIZE = 30;

export const studioModeSchema = z.enum(["normal", "live"]);
export const studioReplyTypeSchema = z.enum(["live", "message"]);
export const studioFeedbackViewSchema = z.enum([
  "unreplied",
  "replied",
  "live",
  "message",
  "todo",
]);

export const studioLoginSchema = z.object({
  username: z.string().trim().min(1, "请输入账号").max(40, "账号格式无效").transform((value) => value.toLowerCase()),
  password: z.string().min(1, "请输入密码").max(200, "密码格式无效"),
});

export const studioModeUpdateSchema = z.object({ mode: studioModeSchema });

export const studioReplyCreateSchema = z.object({
  replyType: studioReplyTypeSchema.optional(),
  content: z.string().trim().min(1, "请填写回复内容").max(2000, "回复内容不能超过 2000 个字符"),
});

export const studioSearchSchema = z.object({
  query: z.string().trim().min(1, "请输入搜索内容").max(100, "搜索内容不能超过 100 个字符"),
  page: z.number().int().min(1).max(10_000).optional().default(1),
  snapshot: z.object({ createdAt: z.number().int().nonnegative(), id: z.string().uuid() }).nullable().optional(),
});

export type StudioMode = z.infer<typeof studioModeSchema>;
export type StudioReplyType = z.infer<typeof studioReplyTypeSchema>;
export type StudioFeedbackView = z.infer<typeof studioFeedbackViewSchema>;

export interface StudioAdmin {
  id: string;
  username: string;
}

export interface StudioSessionSuccess {
  ok: true;
  admin: StudioAdmin;
  mode: StudioMode;
  expiresAt: number;
}

export interface StudioReply {
  id: string;
  replyType: StudioReplyType;
  content: string;
  adminUsername: string | null;
  createdAt: number;
}

export interface StudioFeedbackSummary {
  id: string;
  feedbackNumber: string;
  userId: string;
  nickname: string;
  topic: Topic;
  customTopic: string | null;
  contentPreview: string;
  imageCount: number;
  createdAt: number;
  status: "unreplied" | "replied";
  isTodo: boolean;
  replyCount: number;
  latestReplyAdmin: string | null;
}

export interface StudioFeedbackImage {
  id: string;
  mediaType: "image/webp";
  byteSize: number;
  width: number;
  height: number;
  viewUrl: string;
  downloadUrl: string;
}

export interface StudioFeedbackDetail extends StudioFeedbackSummary {
  content: string;
  maskedPhone: string;
  images: StudioFeedbackImage[];
  replies: StudioReply[];
}

export interface StudioSnapshot {
  createdAt: number;
  id: string;
}

export interface StudioPagination {
  page: number;
  pageSize: typeof STUDIO_PAGE_SIZE;
  total: number;
  totalPages: number;
}

export interface StudioFeedbackListSuccess {
  ok: true;
  items: StudioFeedbackSummary[];
  pagination: StudioPagination;
  snapshot: StudioSnapshot | null;
}

export interface StudioFeedbackDetailSuccess {
  ok: true;
  item: StudioFeedbackDetail;
}

export interface StudioReplyCreateSuccess {
  ok: true;
  reply: StudioReply;
  status: "replied";
  isTodo: false;
  replyCount: number;
  latestReplyAdmin: string | null;
}

export interface StudioTodoSuccess {
  ok: true;
  isTodo: boolean;
}

export interface StudioUserDetailSuccess {
  ok: true;
  user: {
    id: string;
    nickname: string;
    maskedPhone: string;
    firstFeedbackAt: number;
    feedbackCount: number;
  };
  feedbacks: StudioFeedbackSummary[];
}

export interface StudioPhoneRevealSuccess {
  ok: true;
  phone: string;
}

export interface StudioStatsSuccess {
  ok: true;
  todayFeedback: number;
  unreplied: number;
  todo: number;
  todayReplied: number;
}

export interface StudioNewFeedbackCountSuccess {
  ok: true;
  count: number;
}

export interface StudioSearchSuccess extends StudioFeedbackListSuccess {
  queryType: "phone" | "feedback_number" | "nickname";
}
