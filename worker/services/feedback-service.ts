import type { FeedbackSubmission, HistorySuccess, SubmitSuccess } from "../../src/shared/contracts";
import { DatabaseOutcomeUnknownError, PublicError } from "../core/errors";
import type {
  FeedbackRepository,
  ImageCleanupRepository,
  ImageProcessor,
  ImageStorage,
  PhoneCryptoService,
  RateLimitService,
  UserRepository,
} from "../core/ports";
import { MAX_IMAGE_COUNT } from "../security/image";
import type { OtpService } from "./otp-service";

export class FeedbackService {
  constructor(
    private readonly dependencies: {
      feedback: FeedbackRepository;
      imageCleanup: ImageCleanupRepository;
      users: UserRepository;
      images: ImageStorage;
      imageProcessor: ImageProcessor;
      phoneCrypto: PhoneCryptoService;
      rateLimits: RateLimitService;
      otp: OtpService;
      privacyPolicyVersion: string;
      livestreamPolicyVersion: string;
    },
  ) {}

  async submit(input: {
    fields: FeedbackSubmission;
    imageFiles: File[];
    now: number;
  }): Promise<SubmitSuccess> {
    if (input.imageFiles.length > MAX_IMAGE_COUNT) {
      throw new PublicError(400, "IMAGE_INVALID", "每次留言最多上传 3 张图片");
    }
    const phoneHash = await this.dependencies.phoneCrypto.hash(input.fields.phone);
    const idempotent = await this.dependencies.feedback.findIdempotent(
      input.fields.submissionKey,
      phoneHash,
    );
    if (idempotent) return { ok: true, ...idempotent, idempotent: true };

    const user = await this.dependencies.users.findByPhoneHash(phoneHash);
    if (user && user.nickname !== input.fields.nickname) {
      throw new PublicError(409, "NICKNAME_MISMATCH", "此手机号已绑定其他抖音昵称，请检查后重试");
    }
    const submitLimit = await this.dependencies.rateLimits.consume({
      operation: "feedback-submit-phone",
      identity: phoneHash,
      limit: 10,
      windowSeconds: 3600,
      now: input.now,
    });
    if (!submitLimit.allowed) {
      throw new PublicError(429, "RATE_LIMITED", "提交较频繁，请稍后再试", {
        retryAfterSeconds: submitLimit.retryAfterSeconds,
      });
    }
    await this.dependencies.otp.verify({
      phoneHash,
      challengeId: input.fields.challengeId,
      code: input.fields.otp,
      now: input.now,
    });

    let processedImages;
    try {
      processedImages = await Promise.all(
        input.imageFiles.map((file) => this.dependencies.imageProcessor.sanitize(file)),
      );
    } catch (error) {
      throw new PublicError(
        400,
        "IMAGE_INVALID",
        error instanceof Error ? error.message : "图片处理失败，请重新选择",
      );
    }

    const feedbackId = crypto.randomUUID();
    const imageRecords = processedImages.map((image) => ({
      id: crypto.randomUUID(),
      objectKey: `feedback-images/${feedbackId}/${crypto.randomUUID()}.webp`,
      mediaType: "image/webp" as const,
      byteSize: image.byteSize,
      width: image.width,
      height: image.height,
      sha256: image.sha256,
      data: image.data,
    }));
    const uploads = await Promise.allSettled(
      imageRecords.map((image) =>
        this.dependencies.images.putPrivate(image.objectKey, image.data, {
          feedbackId,
          sha256: image.sha256,
        }),
      ),
    );
    const uploadedKeys = uploads.flatMap((result, index) =>
      result.status === "fulfilled" ? [imageRecords[index]!.objectKey] : [],
    );
    if (uploads.some((result) => result.status === "rejected")) {
      await this.cleanup(uploadedKeys, input.now);
      throw new PublicError(503, "SUBMISSION_FAILED", "图片上传失败，请检查网络后重试");
    }

    try {
      const result = await this.dependencies.feedback.createWithUserAndConsumeOtp({
        id: feedbackId,
        submissionKey: input.fields.submissionKey,
        userId: crypto.randomUUID(),
        phoneHash,
        phoneEncrypted: await this.dependencies.phoneCrypto.encrypt(input.fields.phone, phoneHash),
        nickname: input.fields.nickname,
        topic: input.fields.topic,
        customTopic: input.fields.topic === "other" ? input.fields.customTopic : null,
        content: input.fields.content,
        privacyPolicyVersion: this.dependencies.privacyPolicyVersion,
        privacyAgreedAt: input.now,
        livestreamPolicyVersion: this.dependencies.livestreamPolicyVersion,
        livestreamAgreedAt: input.now,
        challengeId: input.fields.challengeId,
        images: imageRecords.map(({ data: _data, ...image }) => image),
        now: input.now,
      });
      if (result.status === "created" || result.status === "idempotent") {
        if (result.status === "idempotent") await this.cleanup(uploadedKeys, input.now);
        return {
          ok: true,
          feedbackId: result.feedbackId,
          createdAt: result.createdAt,
          idempotent: result.status === "idempotent",
        };
      }
      if (result.status === "nickname_mismatch") {
        throw new PublicError(409, "NICKNAME_MISMATCH", "此手机号已绑定其他抖音昵称，请检查后重试");
      }
      throw new PublicError(409, "OTP_INVALID", "验证码已使用，请重新获取");
    } catch (error) {
      await this.cleanup(uploadedKeys, input.now, error instanceof DatabaseOutcomeUnknownError);
      if (error instanceof PublicError) throw error;
      console.error("Feedback transaction failed", {
        kind: error instanceof Error ? error.name : "UnknownError",
      });
      throw new PublicError(503, "SUBMISSION_FAILED", "留言暂时无法提交，请稍后重试");
    }
  }

  async history(input: {
    phone: string;
    nickname: string;
    remoteIp: string | null;
    now: number;
  }): Promise<HistorySuccess> {
    const phoneHash = await this.dependencies.phoneCrypto.hash(input.phone);
    const [phoneLimit, ipLimit] = await Promise.all([
      this.dependencies.rateLimits.consume({
        operation: "history-phone",
        identity: phoneHash,
        limit: 30,
        windowSeconds: 3600,
        now: input.now,
      }),
      this.dependencies.rateLimits.consume({
        operation: "history-ip",
        identity: input.remoteIp ?? "unknown",
        limit: 60,
        windowSeconds: 3600,
        now: input.now,
      }),
    ]);
    if (!phoneLimit.allowed || !ipLimit.allowed) {
      throw new PublicError(429, "RATE_LIMITED", "查询较频繁，请稍后再试", {
        retryAfterSeconds: Math.max(phoneLimit.retryAfterSeconds, ipLimit.retryAfterSeconds),
      });
    }
    const items = await this.dependencies.feedback.findHistory(phoneHash, input.nickname);
    if (!items) {
      throw new PublicError(404, "HISTORY_NOT_FOUND", "未找到匹配的留言记录，请检查手机号和抖音昵称");
    }
    return { ok: true, items };
  }

  private async cleanup(keys: string[], now: number, databaseOutcomeUnknown = false): Promise<void> {
    if (keys.length === 0) return;
    if (databaseOutcomeUnknown) {
      await this.enqueueCleanup(keys, now + 5 * 60 * 1000, now);
      return;
    }

    const results = await Promise.allSettled(keys.map((key) => this.dependencies.images.delete(key)));
    const failedKeys = results.flatMap((result, index) =>
      result.status === "rejected" ? [keys[index]!] : [],
    );
    if (failedKeys.length > 0) await this.enqueueCleanup(failedKeys, now + 60_000, now);
  }

  private async enqueueCleanup(keys: string[], notBefore: number, now: number): Promise<void> {
    try {
      await this.dependencies.imageCleanup.enqueue(keys, notBefore, now);
    } catch (error) {
      console.error("Unable to persist image cleanup task", {
        count: keys.length,
        kind: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}
