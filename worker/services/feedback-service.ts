import type { FeedbackSubmission, HistorySuccess, SubmitSuccess } from "../../src/shared/contracts";
import { DatabaseOutcomeUnknownError, PublicError } from "../core/errors";
import type {
  FeedbackRepository,
  ImageCleanupRepository,
  ImageProcessor,
  ImageStorage,
  TurnstileVerifier,
} from "../core/ports";
import { MAX_IMAGE_COUNT } from "../security/image";

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function beijingDay(now: number): string {
  return new Date(now + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function secondsUntilNextBeijingDay(now: number): number {
  const shifted = new Date(now + BEIJING_OFFSET_MS);
  const nextDay = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
  ) - BEIJING_OFFSET_MS;
  return Math.max(1, Math.ceil((nextDay - now) / 1000));
}

export class FeedbackService {
  constructor(
    private readonly dependencies: {
      feedback: FeedbackRepository;
      imageCleanup: ImageCleanupRepository;
      images: ImageStorage;
      imageProcessor: ImageProcessor;
      turnstile: TurnstileVerifier;
      privacyPolicyVersion: string;
      livestreamPolicyVersion: string;
    },
  ) {}

  async submit(input: {
    fields: FeedbackSubmission;
    imageFiles: File[];
    remoteIp: string | null;
    now: number;
  }): Promise<SubmitSuccess> {
    if (input.imageFiles.length > MAX_IMAGE_COUNT) {
      throw new PublicError(400, "IMAGE_INVALID", "每次留言最多上传 3 张图片");
    }
    const idempotent = await this.dependencies.feedback.findIdempotent(input.fields.submissionKey);
    if (idempotent) return { ok: true, ...idempotent, idempotent: true };

    const turnstileValid = await this.dependencies.turnstile.verify({
      token: input.fields.turnstileToken,
      remoteIp: input.remoteIp,
      expectedAction: "feedback_submit",
    });
    if (!turnstileValid) {
      throw new PublicError(400, "TURNSTILE_FAILED", "安全验证失败，请刷新后重试");
    }

    const day = beijingDay(input.now);
    if (await this.dependencies.feedback.hasReachedDailyLimit(input.fields.nickname, day)) {
      throw new PublicError(429, "RATE_LIMITED", "今天的留言次数已达上限，请明天再来。", {
        retryAfterSeconds: secondsUntilNextBeijingDay(input.now),
      });
    }

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
      const result = await this.dependencies.feedback.create({
        id: feedbackId,
        submissionKey: input.fields.submissionKey,
        nickname: input.fields.nickname,
        beijingDay: day,
        topic: input.fields.topic,
        customTopic: input.fields.topic === "other" ? input.fields.customTopic : null,
        content: input.fields.content,
        privacyPolicyVersion: this.dependencies.privacyPolicyVersion,
        privacyAgreedAt: input.now,
        livestreamPolicyVersion: this.dependencies.livestreamPolicyVersion,
        livestreamAgreedAt: input.now,
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
      if (result.status === "daily_limit") {
        throw new PublicError(429, "RATE_LIMITED", "今天的留言次数已达上限，请明天再来。", {
          retryAfterSeconds: secondsUntilNextBeijingDay(input.now),
        });
      }
      throw new DatabaseOutcomeUnknownError();
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
    nickname: string;
  }): Promise<HistorySuccess> {
    const items = await this.dependencies.feedback.findHistory(input.nickname);
    if (!items) {
      throw new PublicError(404, "HISTORY_NOT_FOUND", "未找到匹配的留言记录，请检查抖音昵称");
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
