import type { StudioMode, StudioSessionSuccess } from "../../src/shared/studio-contracts";
import { PublicError } from "../core/errors";
import type {
  AdminRepository,
  AdminSessionRepository,
  PasswordVerifier,
  StudioSessionRecord,
} from "../core/studio-ports";
import type { RateLimitService } from "../core/ports";
import { sha256 } from "../security/crypto";
import { bytesToBase64Url, utf8 } from "../security/encoding";
import { hashPassword } from "../security/password";

const SESSION_SECONDS = 30 * 24 * 60 * 60;
const DUMMY_PASSWORD_HASH =
  "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function createOpaqueToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export class StudioAuthService {
  constructor(
    private readonly dependencies: {
      admins: AdminRepository;
      sessions: AdminSessionRepository;
      passwords: PasswordVerifier;
      rateLimits: RateLimitService;
    },
  ) {}

  async login(input: {
    username: string;
    password: string;
    remoteIp: string | null;
    now: number;
  }): Promise<{ token: string; session: StudioSessionSuccess }> {
    const [ipLimit, usernameLimit] = await Promise.all([
      this.dependencies.rateLimits.consume({
        operation: "studio-login-ip",
        identity: input.remoteIp ?? "unknown",
        limit: 30,
        windowSeconds: 15 * 60,
        now: input.now,
      }),
      this.dependencies.rateLimits.consume({
        operation: "studio-login-username",
        identity: input.username,
        limit: 10,
        windowSeconds: 15 * 60,
        now: input.now,
      }),
    ]);
    if (!ipLimit.allowed || !usernameLimit.allowed) {
      throw new PublicError(429, "RATE_LIMITED", "登录尝试较频繁，请稍后再试", {
        retryAfterSeconds: Math.max(ipLimit.retryAfterSeconds, usernameLimit.retryAfterSeconds),
      });
    }

    const admin = await this.dependencies.admins.findByUsername(input.username);
    const valid = await this.dependencies.passwords.verify(
      input.password,
      admin?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!admin || !valid) {
      throw new PublicError(401, "AUTH_FAILED", "账号或密码错误");
    }
    if (admin.mustChangePassword) {
      throw new PublicError(403, "PASSWORD_SETUP_REQUIRED", "账号需要设置新密码，请联系管理员初始化");
    }

    const token = createOpaqueToken();
    const tokenHash = await this.hashToken(token);
    const expiresAt = input.now + SESSION_SECONDS * 1000;
    await this.dependencies.sessions.create({
      tokenHash,
      adminId: admin.id,
      mode: "normal",
      createdAt: input.now,
      expiresAt,
    });
    await this.dependencies.admins.recordSuccessfulLogin(admin.id, input.now);
    return {
      token,
      session: {
        ok: true,
        admin: { id: admin.id, username: admin.username },
        mode: "normal",
        expiresAt,
      },
    };
  }

  async authenticate(token: string | undefined, now: number): Promise<StudioSessionRecord> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      throw new PublicError(401, "UNAUTHORIZED", "请先登录 Studio");
    }
    const session = await this.dependencies.sessions.findActive(await this.hashToken(token), now);
    if (!session) throw new PublicError(401, "UNAUTHORIZED", "登录状态已失效，请重新登录");
    return session;
  }

  async changePassword(input: { session: StudioSessionRecord; currentPassword: string; newPassword: string; now: number }): Promise<void> {
    const limit = await this.dependencies.rateLimits.consume({
      operation: "studio-password-change", identity: input.session.admin.id,
      limit: 5, windowSeconds: 900, now: input.now,
    });
    if (!limit.allowed) throw new PublicError(429, "RATE_LIMITED", "尝试较频繁，请稍后再试");
    const admin = await this.dependencies.admins.findByUsername(input.session.admin.username);
    if (!admin || !(await this.dependencies.passwords.verify(input.currentPassword, admin.passwordHash))) {
      throw new PublicError(400, "AUTH_FAILED", "当前密码不正确");
    }
    const changed = await this.dependencies.admins.changePassword(admin.id, admin.passwordHash, await hashPassword(input.newPassword), input.now);
    if (!changed) throw new PublicError(409, "PASSWORD_CHANGED", "密码已被修改，请重新登录");
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return;
    await this.dependencies.sessions.delete(await this.hashToken(token));
  }

  async setMode(token: string, mode: StudioMode, now: number): Promise<StudioSessionRecord> {
    const session = await this.dependencies.sessions.setMode(await this.hashToken(token), mode, now);
    if (!session) throw new PublicError(401, "UNAUTHORIZED", "登录状态已失效，请重新登录");
    return session;
  }

  deleteExpired(now: number): Promise<void> {
    return this.dependencies.sessions.deleteExpired(now);
  }

  private hashToken(token: string): Promise<string> {
    return sha256(utf8(token).buffer);
  }
}
