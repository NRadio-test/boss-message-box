// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { SmsProviderRejectedError } from "../../worker/core/errors";
import type { OtpChallengeRecord, OtpRepository } from "../../worker/core/ports";
import { HmacService } from "../../worker/security/crypto";
import { OtpService } from "../../worker/services/otp-service";

const OTP_KEY = "MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzM=";

type ReleaseSpy = (phoneHash: string, leaseToken: string, now: number) => void;

function otpRepository(releaseReservation: ReleaseSpy): OtpRepository {
  return {
    reserveSend: vi.fn().mockResolvedValue({ reserved: true }),
    commitSent: vi.fn(),
    releaseReservation: async (phoneHash, leaseToken, now) => {
      releaseReservation(phoneHash, leaseToken, now);
    },
    findChallenge: vi.fn().mockResolvedValue(null),
    recordFailedAttempt: vi.fn().mockResolvedValue(1),
  };
}

function createService(error: Error, releaseReservation: ReleaseSpy) {
  return new OtpService({
    users: { findByPhoneHash: vi.fn().mockResolvedValue(null) },
    otp: otpRepository(releaseReservation),
    rateLimits: {
      consume: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
      deleteExpired: vi.fn(),
    },
    phoneCrypto: {
      hash: vi.fn().mockResolvedValue("phone-hash"),
      encrypt: vi.fn(),
      decrypt: vi.fn(),
    },
    sms: { sendOtp: vi.fn().mockRejectedValue(error) },
    turnstile: { verify: vi.fn().mockResolvedValue(true) },
    otpHmacKey: OTP_KEY,
    fixedDevelopmentCode: "123456",
  });
}

const request = {
  phone: "13800138000",
  nickname: "测试昵称",
  turnstileToken: "test-token",
  remoteIp: "203.0.113.1",
  now: 1_800_000_000_000,
};

describe("OTP send outcome handling", () => {
  it("keeps the cooldown lease when the provider outcome is unknown", async () => {
    const releaseReservation = vi.fn();
    const service = createService(new Error("network timeout"), releaseReservation);
    await expect(service.request(request)).rejects.toMatchObject({ code: "SMS_UNAVAILABLE" });
    expect(releaseReservation).not.toHaveBeenCalled();
  });

  it("releases the lease only when the provider explicitly rejects the request", async () => {
    const releaseReservation = vi.fn();
    const service = createService(new SmsProviderRejectedError(), releaseReservation);
    await expect(service.request(request)).rejects.toMatchObject({ code: "SMS_UNAVAILABLE" });
    expect(releaseReservation).toHaveBeenCalledOnce();
  });

  it("generates a fresh six-digit OTP for every production-style request", async () => {
    const generated = [583_921, 104_637];
    const getRandomValues = vi
      .spyOn(globalThis.crypto, "getRandomValues")
      .mockImplementation((array) => {
        if (!(array instanceof Uint32Array)) throw new Error("Expected Uint32Array");
        array[0] = generated.shift()!;
        return array;
      });
    const sent: Array<{ phone: string; code: string; expiresInMinutes: number }> = [];
    const repository = otpRepository(vi.fn());
    const service = new OtpService({
      users: { findByPhoneHash: vi.fn().mockResolvedValue(null) },
      otp: repository,
      rateLimits: {
        consume: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
        deleteExpired: vi.fn(),
      },
      phoneCrypto: {
        hash: vi.fn().mockResolvedValue("phone-hash"),
        encrypt: vi.fn(),
        decrypt: vi.fn(),
      },
      sms: {
        sendOtp: vi.fn(async (input) => {
          sent.push(input);
        }),
      },
      turnstile: { verify: vi.fn().mockResolvedValue(true) },
      otpHmacKey: OTP_KEY,
    });

    await service.request(request);
    await service.request({ ...request, now: request.now + 120_000 });

    expect(sent).toEqual([
      { phone: request.phone, code: "583921", expiresInMinutes: 5 },
      { phone: request.phone, code: "104637", expiresInMinutes: 5 },
    ]);
    expect(sent.every(({ code }) => /^\d{6}$/u.test(code))).toBe(true);
    expect(new Set(sent.map(({ code }) => code)).size).toBe(sent.length);
    getRandomValues.mockRestore();
  });
});

async function verificationSetup(input: {
  attemptCount?: number;
  expiresAt?: number;
  recordFailedAttempt?: number;
}) {
  const now = 1_800_000_000_000;
  const challenge: OtpChallengeRecord = {
    id: "challenge-id",
    phoneHash: "phone-hash",
    nonce: "nonce",
    codeMac: await new HmacService(OTP_KEY, "OTP_HMAC_KEY").sign(
      "challenge-id:phone-hash:nonce:123456",
    ),
    sentAt: now - 1_000,
    expiresAt: input.expiresAt ?? now + 300_000,
    attemptCount: input.attemptCount ?? 0,
    consumedAt: null,
    invalidatedAt: null,
  };
  const repository = otpRepository(vi.fn());
  vi.mocked(repository.findChallenge).mockResolvedValue(challenge);
  vi.mocked(repository.recordFailedAttempt).mockResolvedValue(input.recordFailedAttempt ?? 1);
  const service = new OtpService({
    users: { findByPhoneHash: vi.fn().mockResolvedValue(null) },
    otp: repository,
    rateLimits: {
      consume: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
      deleteExpired: vi.fn(),
    },
    phoneCrypto: {
      hash: vi.fn(),
      encrypt: vi.fn(),
      decrypt: vi.fn(),
    },
    sms: { sendOtp: vi.fn() },
    turnstile: { verify: vi.fn() },
    otpHmacKey: OTP_KEY,
  });
  return { now, repository, service };
}

describe("OTP verification boundaries", () => {
  it("rejects an expired OTP before comparing or recording the code", async () => {
    const { now, repository, service } = await verificationSetup({ expiresAt: nowMinusOne() });

    await expect(
      service.verify({ phoneHash: "phone-hash", challengeId: "challenge-id", code: "123456", now }),
    ).rejects.toMatchObject({ status: 400, code: "OTP_EXPIRED" });
    expect(repository.recordFailedAttempt).not.toHaveBeenCalled();
  });

  it("records an incorrect OTP attempt and returns the retryable error before attempt six", async () => {
    const { now, repository, service } = await verificationSetup({ recordFailedAttempt: 1 });

    await expect(
      service.verify({ phoneHash: "phone-hash", challengeId: "challenge-id", code: "654321", now }),
    ).rejects.toMatchObject({ status: 400, code: "OTP_INVALID" });
    expect(repository.recordFailedAttempt).toHaveBeenCalledWith("challenge-id", now);
  });

  it("locks the challenge with the attempts-exceeded error on the sixth incorrect OTP", async () => {
    const { now, repository, service } = await verificationSetup({
      attemptCount: 5,
      recordFailedAttempt: 6,
    });

    await expect(
      service.verify({ phoneHash: "phone-hash", challengeId: "challenge-id", code: "654321", now }),
    ).rejects.toMatchObject({ status: 429, code: "OTP_ATTEMPTS_EXCEEDED" });
    expect(repository.recordFailedAttempt).toHaveBeenCalledWith("challenge-id", now);
  });

  it("does not mutate an OTP that is already at the six-attempt limit", async () => {
    const { now, repository, service } = await verificationSetup({ attemptCount: 6 });

    await expect(
      service.verify({ phoneHash: "phone-hash", challengeId: "challenge-id", code: "123456", now }),
    ).rejects.toMatchObject({ status: 429, code: "OTP_ATTEMPTS_EXCEEDED" });
    expect(repository.recordFailedAttempt).not.toHaveBeenCalled();
  });
});

function nowMinusOne(): number {
  return 1_800_000_000_000 - 1;
}
