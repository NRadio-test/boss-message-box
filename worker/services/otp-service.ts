import type { OtpRequestSuccess } from "../../src/shared/contracts";
import { PublicError, SmsProviderRejectedError } from "../core/errors";
import type {
  OtpRepository,
  PhoneCryptoService,
  RateLimitService,
  SmsProvider,
  TurnstileVerifier,
  UserRepository,
} from "../core/ports";
import { HmacService } from "../security/crypto";

const OTP_VALIDITY_SECONDS = 5 * 60;
const OTP_COOLDOWN_SECONDS = 120;
const OTP_LEASE_SECONDS = 120;
const OTP_MAX_ATTEMPTS = 6;

function randomSixDigitCode(): string {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values);
  while (values[0]! >= limit);
  return String(values[0]! % 1_000_000).padStart(6, "0");
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)} **** ${phone.slice(-4)}`;
}

export class OtpService {
  private readonly codeMac: HmacService;

  constructor(
    private readonly dependencies: {
      users: UserRepository;
      otp: OtpRepository;
      rateLimits: RateLimitService;
      phoneCrypto: PhoneCryptoService;
      sms: SmsProvider;
      turnstile: TurnstileVerifier;
      otpHmacKey: string;
      fixedDevelopmentCode?: string;
    },
  ) {
    this.codeMac = new HmacService(dependencies.otpHmacKey, "OTP_HMAC_KEY");
  }

  async request(input: {
    phone: string;
    nickname: string;
    turnstileToken: string;
    remoteIp: string | null;
    now: number;
  }): Promise<OtpRequestSuccess> {
    const human = await this.dependencies.turnstile.verify({
      token: input.turnstileToken,
      remoteIp: input.remoteIp,
      expectedAction: "request_otp",
    });

    if (!human) {
      throw new PublicError(400, "TURNSTILE_FAILED", "人机验证未通过，请重试");
    }

    const phoneHash = await this.dependencies.phoneCrypto.hash(input.phone);
    const existingUser = await this.dependencies.users.findByPhoneHash(phoneHash);

    if (existingUser && existingUser.nickname !== input.nickname) {
      throw new PublicError(
        409,
        "NICKNAME_MISMATCH",
        "此手机号已绑定其他抖音昵称，请检查后重试",
      );
    }

    const [phoneLimit, ipLimit] = await Promise.all([
      this.dependencies.rateLimits.consume({
        operation: "otp-send-phone",
        identity: phoneHash,
        limit: 5,
        windowSeconds: 3600,
        now: input.now,
      }),
      this.dependencies.rateLimits.consume({
        operation: "otp-send-ip",
        identity: input.remoteIp ?? "unknown",
        limit: 20,
        windowSeconds: 3600,
        now: input.now,
      }),
    ]);

    if (!phoneLimit.allowed || !ipLimit.allowed) {
      const retryAfterSeconds = Math.max(
        phoneLimit.retryAfterSeconds,
        ipLimit.retryAfterSeconds,
      );

      throw new PublicError(
        429,
        "RATE_LIMITED",
        "验证码请求较频繁，请稍后再试",
        { retryAfterSeconds },
      );
    }

    const leaseToken = crypto.randomUUID();

    const reservation = await this.dependencies.otp.reserveSend({
      phoneHash,
      leaseToken,
      now: input.now,
      leaseSeconds: OTP_LEASE_SECONDS,
      cooldownSeconds: OTP_COOLDOWN_SECONDS,
    });

    if (!reservation.reserved) {
      throw new PublicError(
        429,
        "OTP_COOLDOWN",
        `请等待约 ${reservation.retryAfterSeconds} 秒后重新发送`,
        { retryAfterSeconds: reservation.retryAfterSeconds },
      );
    }

    const challengeId = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const code =
      this.dependencies.fixedDevelopmentCode ?? randomSixDigitCode();

    const codeMac = await this.codeMac.sign(
      `${challengeId}:${phoneHash}:${nonce}:${code}`,
    );

    try {
      await this.dependencies.sms.sendOtp({
        phone: input.phone,
        code,
        expiresInMinutes: 5,
      });

      const sentAt = Date.now();

      await this.dependencies.otp.commitSent({
        challengeId,
        phoneHash,
        leaseToken,
        codeMac,
        nonce,
        now: sentAt,
        expiresAt: sentAt + OTP_VALIDITY_SECONDS * 1000,
      });

      return {
        ok: true,
        challengeId,
        maskedPhone: maskPhone(input.phone),
        expiresAt: sentAt + OTP_VALIDITY_SECONDS * 1000,
        cooldownEndsAt: sentAt + OTP_COOLDOWN_SECONDS * 1000,
        serverNow: sentAt,
      };
    } catch (error) {
      // Only an explicit provider rejection proves no SMS was accepted. A
      // timeout or broken response is an unknown outcome, so the lease stays
      // in place for the full 120-second cooldown to prevent duplicate sends.
      if (error instanceof SmsProviderRejectedError) {
        await this.dependencies.otp
          .releaseReservation(phoneHash, leaseToken, Date.now())
          .catch(() => undefined);
      }

      console.error("OTP send failed", {
        kind: error instanceof Error ? error.name : "UnknownError",
      });

      throw new PublicError(
        503,
        "SMS_UNAVAILABLE",
        "验证码暂时无法发送，请稍后重试",
      );
    }
  }

  async verify(input: {
    phoneHash: string;
    challengeId: string;
    code: string;
    now: number;
  }): Promise<void> {
    const challenge = await this.dependencies.otp.findChallenge(
      input.challengeId,
      input.phoneHash,
    );

    if (!challenge || challenge.consumedAt || challenge.invalidatedAt) {
      throw new PublicError(
        400,
        "OTP_INVALID",
        "验证码无效，请重新获取",
      );
    }

    if (challenge.expiresAt < input.now) {
      throw new PublicError(
        400,
        "OTP_EXPIRED",
        "验证码已过期，请重新获取",
      );
    }

    if (challenge.attemptCount >= OTP_MAX_ATTEMPTS) {
      throw new PublicError(
        429,
        "OTP_ATTEMPTS_EXCEEDED",
        "尝试次数过多，请重新获取验证码",
      );
    }

    const valid = await this.codeMac.verify(
      `${challenge.id}:${challenge.phoneHash}:${challenge.nonce}:${input.code}`,
      challenge.codeMac,
    );

    if (!valid) {
      const attempts = await this.dependencies.otp.recordFailedAttempt(
        challenge.id,
        input.now,
      );

      if (attempts >= OTP_MAX_ATTEMPTS) {
        throw new PublicError(
          429,
          "OTP_ATTEMPTS_EXCEEDED",
          "尝试次数过多，请重新获取验证码",
        );
      }

      throw new PublicError(
        400,
        "OTP_INVALID",
        "验证码不正确，请检查后重试",
      );
    }
  }
}