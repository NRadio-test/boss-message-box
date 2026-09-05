// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { FeedbackSubmission } from "../../src/shared/contracts";
import type {
  FeedbackRepository,
  ImageCleanupRepository,
  ImageProcessor,
  ImageStorage,
  TurnstileVerifier,
} from "../../worker/core/ports";
import { FeedbackService } from "../../worker/services/feedback-service";

const now = Date.UTC(2026, 8, 4, 4, 0, 0);
const fields: FeedbackSubmission = {
  submissionKey: "2e7aa396-82af-4a10-b1d0-69cd587df44f",
  topic: "appeal",
  customTopic: null,
  content: "上传验收测试",
  nickname: "测试昵称",
  privacyAgreed: true,
  livestreamAgreed: true,
  turnstileToken: "turnstile-token",
};

function image(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/webp" });
}

function setup() {
  const feedback: FeedbackRepository = {
    findIdempotent: vi.fn().mockResolvedValue(null),
    hasReachedDailyLimit: vi.fn().mockResolvedValue(false),
    create: vi.fn().mockResolvedValue({
      status: "created",
      feedbackId: "feedback-id",
      createdAt: now,
    }),
    findHistory: vi.fn(),
    setModerationResult: vi.fn(),
  };
  const imageCleanup: ImageCleanupRepository = {
    enqueue: vi.fn(),
    listDue: vi.fn(),
    isReferenced: vi.fn(),
    complete: vi.fn(),
    retry: vi.fn(),
  };
  const images: ImageStorage = { putPrivate: vi.fn(), delete: vi.fn() };
  const imageProcessor: ImageProcessor = {
    sanitize: vi.fn().mockResolvedValue({
      data: new Uint8Array([1, 2, 3]).buffer,
      byteSize: 3,
      width: 1,
      height: 1,
      sha256: "sha256",
    }),
  };
  const turnstile: TurnstileVerifier = { verify: vi.fn().mockResolvedValue(true) };
  const service = new FeedbackService({
    feedback,
    imageCleanup,
    images,
    imageProcessor,
    turnstile,
    privacyPolicyVersion: "2026-09-03",
    livestreamPolicyVersion: "2026-09-03",
  });
  return { feedback, imageCleanup, images, imageProcessor, service, turnstile };
}

describe("nickname submission limits", () => {
  it("returns a bounded history page and a cursor, then allows an empty last page", async () => {
    const { feedback, service } = setup();
    const items = Array.from({ length: 31 }, (_, index) => ({ id: crypto.randomUUID(), topic: "appeal" as const, customTopic: null, content: `留言${index}`, imageCount: 0, status: "unreplied" as const, replies: [], replyContent: null, createdAt: now - index }));
    vi.mocked(feedback.findHistory).mockResolvedValueOnce(items).mockResolvedValueOnce(null);
    const first = await service.history({ nickname: "测试昵称" });
    expect(first.items).toHaveLength(30);
    expect(first.nextCursor).toEqual({ id: items[29]!.id, createdAt: items[29]!.createdAt });
    const before = first.nextCursor!;
    expect(await service.history({ nickname: "测试昵称", before })).toEqual({ ok: true, items: [], nextCursor: null });
    expect(feedback.findHistory).toHaveBeenLastCalledWith("测试昵称", before);
  });
  it("submits without phone or OTP and accounts against the Beijing calendar day", async () => {
    const { feedback, service, turnstile } = setup();

    await expect(
      service.submit({ fields, imageFiles: [], remoteIp: "203.0.113.1", now }),
    ).resolves.toMatchObject({ ok: true, feedbackId: "feedback-id", idempotent: false });

    expect(turnstile.verify).toHaveBeenCalledExactlyOnceWith({
      token: "turnstile-token",
      remoteIp: "203.0.113.1",
      expectedAction: "feedback_submit",
    });
    expect(feedback.hasReachedDailyLimit).toHaveBeenCalledExactlyOnceWith("测试昵称", "2026-09-04");
    expect(feedback.create).toHaveBeenCalledWith(
      expect.objectContaining({ nickname: "测试昵称", beijingDay: "2026-09-04" }),
    );
  });

  it("returns an existing idempotent submission without consuming another daily slot", async () => {
    const { feedback, service, turnstile } = setup();
    vi.mocked(feedback.findIdempotent).mockResolvedValue({
      feedbackId: "existing-id",
      createdAt: now - 1,
    });

    await expect(
      service.submit({ fields, imageFiles: [], remoteIp: null, now }),
    ).resolves.toEqual({
      ok: true,
      feedbackId: "existing-id",
      createdAt: now - 1,
      idempotent: true,
    });
    expect(turnstile.verify).not.toHaveBeenCalled();
    expect(feedback.hasReachedDailyLimit).not.toHaveBeenCalled();
    expect(feedback.create).not.toHaveBeenCalled();
  });

  it("rejects the eleventh successful submission for the exact nickname", async () => {
    const { feedback, service } = setup();
    vi.mocked(feedback.hasReachedDailyLimit).mockResolvedValue(true);

    await expect(
      service.submit({ fields, imageFiles: [], remoteIp: null, now }),
    ).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(feedback.create).not.toHaveBeenCalled();
  });
});

describe("feedback upload acceptance boundaries", () => {
  it("rejects four images before Turnstile verification or image processing", async () => {
    const { feedback, images, imageProcessor, service, turnstile } = setup();

    await expect(
      service.submit({
        fields,
        imageFiles: [image("1.webp"), image("2.webp"), image("3.webp"), image("4.webp")],
        remoteIp: null,
        now,
      }),
    ).rejects.toMatchObject({ status: 400, code: "IMAGE_INVALID" });
    expect(turnstile.verify).not.toHaveBeenCalled();
    expect(imageProcessor.sanitize).not.toHaveBeenCalled();
    expect(images.putPrivate).not.toHaveBeenCalled();
    expect(feedback.create).not.toHaveBeenCalled();
  });

  it("deletes every successfully uploaded object when another upload fails", async () => {
    const { feedback, imageCleanup, images, service } = setup();
    vi.mocked(images.putPrivate)
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("R2 unavailable"));

    await expect(
      service.submit({
        fields,
        imageFiles: [image("first.webp"), image("second.webp")],
        remoteIp: null,
        now,
      }),
    ).rejects.toMatchObject({ status: 503, code: "SUBMISSION_FAILED" });

    expect(images.putPrivate).toHaveBeenCalledTimes(2);
    const uploadedKey = vi.mocked(images.putPrivate).mock.calls[0]![0];
    expect(images.delete).toHaveBeenCalledTimes(2);
    expect(images.delete).toHaveBeenCalledWith(uploadedKey);
    expect(images.delete).toHaveBeenCalledWith(vi.mocked(images.putPrivate).mock.calls[1]![0]);
    expect(imageCleanup.enqueue).not.toHaveBeenCalled();
    expect(feedback.create).not.toHaveBeenCalled();
  });

  it("queues persistent cleanup if immediate compensation deletion also fails", async () => {
    const { feedback, imageCleanup, images, service } = setup();
    vi.mocked(images.putPrivate)
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("R2 upload unavailable"));
    vi.mocked(images.delete).mockRejectedValueOnce(new Error("R2 delete unavailable"));

    await expect(
      service.submit({
        fields,
        imageFiles: [image("first.webp"), image("second.webp")],
        remoteIp: null,
        now,
      }),
    ).rejects.toMatchObject({ status: 503, code: "SUBMISSION_FAILED" });

    const uploadedKey = vi.mocked(images.putPrivate).mock.calls[0]![0];
    expect(imageCleanup.enqueue).toHaveBeenCalledExactlyOnceWith([uploadedKey], now + 60_000, now);
    expect(feedback.create).not.toHaveBeenCalled();
  });
});
