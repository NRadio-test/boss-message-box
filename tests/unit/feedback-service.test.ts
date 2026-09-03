// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { FeedbackSubmission } from "../../src/shared/contracts";
import type {
  FeedbackRepository,
  ImageCleanupRepository,
  ImageProcessor,
  ImageStorage,
  PhoneCryptoService,
  RateLimitService,
  UserRepository,
} from "../../worker/core/ports";
import { FeedbackService } from "../../worker/services/feedback-service";
import type { OtpService } from "../../worker/services/otp-service";

const now = 1_800_000_000_000;
const fields: FeedbackSubmission = {
  submissionKey: "2e7aa396-82af-4a10-b1d0-69cd587df44f",
  topic: "appeal",
  customTopic: null,
  content: "上传验收测试",
  nickname: "测试昵称",
  phone: "13800138000",
  privacyAgreed: true,
  livestreamAgreed: true,
  challengeId: "1b8d3998-d4ae-4e98-bdce-a570b5a6d15f",
  otp: "123456",
};

function image(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/webp" });
}

function setup() {
  const feedback: FeedbackRepository = {
    findIdempotent: vi.fn().mockResolvedValue(null),
    createWithUserAndConsumeOtp: vi.fn().mockResolvedValue({
      status: "created",
      feedbackId: "feedback-id",
      createdAt: now,
    }),
    findHistory: vi.fn(),
  };
  const imageCleanup: ImageCleanupRepository = {
    enqueue: vi.fn(),
    listDue: vi.fn(),
    isReferenced: vi.fn(),
    complete: vi.fn(),
    retry: vi.fn(),
  };
  const users: UserRepository = { findByPhoneHash: vi.fn().mockResolvedValue(null) };
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
  const phoneCrypto: PhoneCryptoService = {
    hash: vi.fn().mockResolvedValue("phone-hash"),
    encrypt: vi.fn().mockResolvedValue("v1.iv.ciphertext"),
    decrypt: vi.fn(),
  };
  const rateLimits: RateLimitService = {
    consume: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
    deleteExpired: vi.fn(),
  };
  const otp = { verify: vi.fn() } as unknown as OtpService;
  const service = new FeedbackService({
    feedback,
    imageCleanup,
    users,
    images,
    imageProcessor,
    phoneCrypto,
    rateLimits,
    otp,
    privacyPolicyVersion: "2026-09-03",
    livestreamPolicyVersion: "2026-09-03",
  });
  return {
    feedback,
    imageCleanup,
    images,
    imageProcessor,
    otp,
    phoneCrypto,
    rateLimits,
    service,
    users,
  };
}

describe("phone and nickname binding acceptance boundaries", () => {
  it("accepts another submission when the existing phone uses its bound nickname", async () => {
    const { feedback, otp, service, users } = setup();
    vi.mocked(users.findByPhoneHash).mockResolvedValue({
      id: "existing-user-id",
      phoneHash: "phone-hash",
      nickname: fields.nickname,
    });

    await expect(service.submit({ fields, imageFiles: [], now })).resolves.toMatchObject({
      ok: true,
      feedbackId: "feedback-id",
      idempotent: false,
    });
    expect(otp.verify).toHaveBeenCalledOnce();
    expect(feedback.createWithUserAndConsumeOtp).toHaveBeenCalledOnce();
  });

  it("rejects a different nickname for an existing phone before OTP verification", async () => {
    const { feedback, otp, rateLimits, service, users } = setup();
    vi.mocked(users.findByPhoneHash).mockResolvedValue({
      id: "existing-user-id",
      phoneHash: "phone-hash",
      nickname: "原绑定昵称",
    });

    await expect(service.submit({ fields, imageFiles: [], now })).rejects.toMatchObject({
      status: 409,
      code: "NICKNAME_MISMATCH",
    });
    expect(rateLimits.consume).not.toHaveBeenCalled();
    expect(otp.verify).not.toHaveBeenCalled();
    expect(feedback.createWithUserAndConsumeOtp).not.toHaveBeenCalled();
  });
});

describe("feedback upload acceptance boundaries", () => {
  it("rejects four images server-side before OTP verification or image processing", async () => {
    const { feedback, images, imageProcessor, otp, phoneCrypto, service } = setup();

    await expect(
      service.submit({
        fields,
        imageFiles: [image("1.webp"), image("2.webp"), image("3.webp"), image("4.webp")],
        now,
      }),
    ).rejects.toMatchObject({ status: 400, code: "IMAGE_INVALID" });
    expect(phoneCrypto.hash).not.toHaveBeenCalled();
    expect(otp.verify).not.toHaveBeenCalled();
    expect(imageProcessor.sanitize).not.toHaveBeenCalled();
    expect(images.putPrivate).not.toHaveBeenCalled();
    expect(feedback.createWithUserAndConsumeOtp).not.toHaveBeenCalled();
  });

  it("deletes every successfully uploaded object when another image upload fails", async () => {
    const { feedback, imageCleanup, images, otp, service } = setup();
    vi.mocked(images.putPrivate)
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("R2 unavailable"));

    await expect(
      service.submit({ fields, imageFiles: [image("first.webp"), image("second.webp")], now }),
    ).rejects.toMatchObject({ status: 503, code: "SUBMISSION_FAILED" });

    expect(otp.verify).toHaveBeenCalledOnce();
    expect(images.putPrivate).toHaveBeenCalledTimes(2);
    const uploadedKey = vi.mocked(images.putPrivate).mock.calls[0]![0];
    expect(images.delete).toHaveBeenCalledExactlyOnceWith(uploadedKey);
    expect(imageCleanup.enqueue).not.toHaveBeenCalled();
    expect(feedback.createWithUserAndConsumeOtp).not.toHaveBeenCalled();
  });

  it("queues persistent cleanup if immediate compensation deletion also fails", async () => {
    const { feedback, imageCleanup, images, service } = setup();
    vi.mocked(images.putPrivate)
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("R2 upload unavailable"));
    vi.mocked(images.delete).mockRejectedValueOnce(new Error("R2 delete unavailable"));

    await expect(
      service.submit({ fields, imageFiles: [image("first.webp"), image("second.webp")], now }),
    ).rejects.toMatchObject({ status: 503, code: "SUBMISSION_FAILED" });

    const uploadedKey = vi.mocked(images.putPrivate).mock.calls[0]![0];
    expect(imageCleanup.enqueue).toHaveBeenCalledExactlyOnceWith(
      [uploadedKey],
      now + 60_000,
      now,
    );
    expect(feedback.createWithUserAndConsumeOtp).not.toHaveBeenCalled();
  });
});
