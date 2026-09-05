import type {
  StudioAdmin,
  StudioFeedbackDetail,
  StudioFeedbackListSuccess,
  StudioFeedbackSummary,
  StudioFeedbackView,
  StudioMode,
  StudioReply,
  StudioReplyType,
  StudioStatsSuccess,
  StudioUserDetailSuccess,
} from "../../src/shared/studio-contracts";
import type { Topic } from "../../src/shared/contracts";

export interface AdminRecord extends StudioAdmin {
  passwordHash: string;
  mustChangePassword?: boolean;
}

export interface StudioSessionRecord {
  tokenHash: string;
  admin: StudioAdmin;
  mode: StudioMode;
  expiresAt: number;
}

export interface AdminRepository {
  findByUsername(username: string): Promise<AdminRecord | null>;
  recordSuccessfulLogin(adminId: string, now: number): Promise<void>;
  changePassword(adminId: string, previousHash: string, nextHash: string, now: number): Promise<boolean>;
}

export interface AdminSessionRepository {
  create(input: {
    tokenHash: string;
    adminId: string;
    mode: StudioMode;
    createdAt: number;
    expiresAt: number;
  }): Promise<void>;
  findActive(tokenHash: string, now: number): Promise<StudioSessionRecord | null>;
  setMode(tokenHash: string, mode: StudioMode, now: number): Promise<StudioSessionRecord | null>;
  delete(tokenHash: string): Promise<void>;
  deleteExpired(now: number): Promise<void>;
}

export interface StudioListInput {
  readyOnly?: boolean;
  view: StudioFeedbackView;
  topic: Topic | null;
  page: number;
  snapshot: { createdAt: number; id: string } | null;
}

export interface StudioSearchInput {
  queryType: "phone" | "feedback_number" | "nickname" | "combined";
  queryValue: string;
  page: number;
  snapshot: { createdAt: number; id: string } | null;
}

export interface StudioImageRecord {
  objectKey: string;
  byteSize: number;
}

export interface PrivateImageReader {
  getPrivate(key: string): Promise<{
    body: ReadableStream;
    size: number;
    etag: string;
  } | null>;
}

export interface StudioRepository {
  listFeedbacks(input: StudioListInput): Promise<StudioFeedbackListSuccess>;
  searchFeedbacks(input: StudioSearchInput): Promise<StudioFeedbackListSuccess>;
  findFeedback(feedbackId: string): Promise<StudioFeedbackDetail | null>;
  appendReply(input: {
    requestKey?: string;
    liveMode?: boolean;
    id: string;
    feedbackId: string;
    replyType: StudioReplyType;
    content: string;
    admin: StudioAdmin;
    now: number;
  }): Promise<{
    reply: StudioReply;
    replyCount: number;
    latestReplyAdmin: string | null;
  } | null>;
  setTodo(input: {
    feedbackId: string;
    isTodo: boolean;
    adminId: string;
    now: number;
  }): Promise<boolean | null>;
  findUser(userId: string): Promise<StudioUserDetailSuccess | null>;
  findEncryptedPhone(userId: string): Promise<{ phoneHash: string; phoneEncrypted: string } | null>;
  getStats(todayStartedAt: number): Promise<Omit<StudioStatsSuccess, "ok">>;
  countNewFeedback(after: { createdAt: number; id: string }, topic: Topic | null, readyOnly?: boolean): Promise<number>;
  findImage(feedbackId: string, imageId: string): Promise<StudioImageRecord | null>;
  feedbackExists(feedbackId: string): Promise<boolean>;
  getFeedbackSummary(feedbackId: string): Promise<StudioFeedbackSummary | null>;
  setModeration(input: {
    feedbackId: string;
    filtered: boolean;
    adminId: string;
    now: number;
  }): Promise<{ moderationStatus: "filtered" | "kept"; isTodo: false } | null>;
  findNextFeedback(input: {
    currentFeedbackId: string;
    view: "unreplied" | "todo";
    topic: Topic | null;
  }): Promise<string | null>;
}

export interface PasswordVerifier {
  verify(password: string, encodedHash: string): Promise<boolean>;
}
