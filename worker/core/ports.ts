import type { HistoryQuery, PublicFeedback, Topic } from "../../src/shared/contracts";

export interface UserRecord {
  id: string;
  phoneHash: string;
  nickname: string;
}

export interface UserRepository {
  findByPhoneHash(phoneHash: string): Promise<UserRecord | null>;
}

export interface StoredImageInput {
  id: string;
  objectKey: string;
  mediaType: "image/webp";
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
}

export interface CreateFeedbackInput {
  id: string;
  submissionKey: string;
  nickname: string;
  topic: Topic;
  customTopic: string | null;
  content: string;
  privacyPolicyVersion: string;
  privacyAgreedAt: number;
  livestreamPolicyVersion: string;
  livestreamAgreedAt: number;
  beijingDay: string;
  images: StoredImageInput[];
  now: number;
}

export type CreateFeedbackResult =
  | { status: "created"; feedbackId: string; createdAt: number }
  | { status: "idempotent"; feedbackId: string; createdAt: number }
  | { status: "daily_limit" };

export interface FeedbackRepository {
  findIdempotent(
    submissionKey: string,
  ): Promise<{ feedbackId: string; createdAt: number } | null>;
  hasReachedDailyLimit(nickname: string, beijingDay: string): Promise<boolean>;
  create(input: CreateFeedbackInput): Promise<CreateFeedbackResult>;
  findHistory(nickname: string, before?: { createdAt: number; id: string }): Promise<PublicFeedback[] | null>;
  setModerationResult(input: {
    feedbackId: string;
    attemptToken: string;
    status: "kept" | "filtered" | "failed";
    category: "valid_feedback" | "abusive" | "meaningless" | "uncertain" | null;
    reason: string | null;
    now: number;
    nextRetryAt?: number;
  }): Promise<void>;
}

export interface ModerationJob {
  feedbackId: string;
  attemptToken: string;
  attempts: number;
  topic: string;
  content: string;
}

export interface ModerationJobRepository {
  claim(input: { feedbackId: string; now: number; manual?: boolean }): Promise<ModerationJob | null>;
  listDue(now: number, limit: number): Promise<string[]>;
  expireExhausted(now: number): Promise<void>;
}

export interface AiModerationDecision {
  decision: "keep" | "filter";
  category: "valid_feedback" | "abusive" | "meaningless" | "uncertain";
  reason: string;
}

export interface AiModerationProvider {
  classify(input: { topic: string; content: string }): Promise<AiModerationDecision>;
}

export interface ImageStorage {
  putPrivate(
    key: string,
    data: ArrayBuffer,
    metadata: { feedbackId: string; sha256: string },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface ImageCleanupRecord {
  objectKey: string;
  attemptCount: number;
}

export interface ImageCleanupRepository {
  enqueue(objectKeys: string[], notBefore: number, now: number): Promise<void>;
  listDue(now: number, limit: number): Promise<ImageCleanupRecord[]>;
  isReferenced(objectKey: string): Promise<boolean>;
  complete(objectKey: string): Promise<void>;
  retry(objectKey: string, notBefore: number, errorCode: string, now: number): Promise<void>;
}

export interface ProcessedImage {
  data: ArrayBuffer;
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
}

export interface ImageProcessor {
  sanitize(file: File): Promise<ProcessedImage>;
}

export interface SmsProvider {
  sendOtp(input: { phone: string; code: string; expiresInMinutes: number }): Promise<void>;
}

export interface PhoneCryptoService {
  hash(phone: string): Promise<string>;
  encrypt(phone: string, phoneHash: string): Promise<string>;
  decrypt(ciphertext: string, phoneHash: string): Promise<string>;
}

export interface RateLimitService {
  consume(input: {
    operation: string;
    identity: string;
    limit: number;
    windowSeconds: number;
    now: number;
  }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  deleteExpired(now: number): Promise<void>;
}

export interface OtpChallengeRecord {
  id: string;
  phoneHash: string;
  codeMac: string;
  nonce: string;
  sentAt: number;
  expiresAt: number;
  attemptCount: number;
  consumedAt: number | null;
  invalidatedAt: number | null;
}

export interface OtpRepository {
  reserveSend(input: {
    phoneHash: string;
    leaseToken: string;
    now: number;
    leaseSeconds: number;
    cooldownSeconds: number;
  }): Promise<{ reserved: true } | { reserved: false; retryAfterSeconds: number }>;
  commitSent(input: {
    challengeId: string;
    phoneHash: string;
    leaseToken: string;
    codeMac: string;
    nonce: string;
    now: number;
    expiresAt: number;
  }): Promise<void>;
  releaseReservation(phoneHash: string, leaseToken: string, now: number): Promise<void>;
  findChallenge(challengeId: string, phoneHash: string): Promise<OtpChallengeRecord | null>;
  recordFailedAttempt(challengeId: string, now: number): Promise<number>;
}

export interface TurnstileVerifier {
  verify(input: {
    token: string;
    remoteIp: string | null;
    expectedAction: string;
  }): Promise<boolean>;
}

export interface Clock {
  now(): number;
}

export interface IdGenerator {
  generate(): string;
}

export type HistoryRepositoryInput = HistoryQuery;
