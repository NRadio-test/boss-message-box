import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import {
  feedbackSubmissionSchema,
  historyQuerySchema,
  otpRequestSchema,
  type ApiErrorBody,
} from "../src/shared/contracts";
import { PublicError } from "./core/errors";
import type { Env } from "./env";
import { CloudflareImageProcessor } from "./infra/cloudflare-image-processor";
import {
  D1FeedbackRepository,
  D1ImageCleanupRepository,
  D1OtpRepository,
  D1RateLimitService,
  D1UserRepository,
} from "./infra/d1-repositories";
import { R2ImageStorage } from "./infra/r2-image-storage";
import { createSmsProvider } from "./providers/sms";
import { CloudflareTurnstileVerifier } from "./providers/turnstile";
import { WebCryptoPhoneService } from "./security/crypto";
import { FeedbackService } from "./services/feedback-service";
import { ImageCleanupService } from "./services/image-cleanup-service";
import { OtpService } from "./services/otp-service";

type AppBindings = { Bindings: Env; Variables: { requestId: string } };
const app = new Hono<AppBindings>();

app.use("/api/*", secureHeaders());
app.use("/api/*", async (context, next) => {
  context.set("requestId", crypto.randomUUID());
  await next();
  context.header("Cache-Control", "no-store");
  context.header("X-Request-Id", context.get("requestId"));
});

function fieldErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): Record<string, string> {
  return Object.fromEntries(error.issues.map((issue) => [String(issue.path[0] ?? "form"), issue.message]));
}

function remoteIp(request: Request): string | null {
  return request.headers.get("CF-Connecting-IP");
}

function createServices(env: Env): { otp: OtpService; feedback: FeedbackService; rateLimits: D1RateLimitService } {
  const users = new D1UserRepository(env.BOSS_MESSAGE_DB);
  const otpRepository = new D1OtpRepository(env.BOSS_MESSAGE_DB);
  const rateLimits = new D1RateLimitService(env.BOSS_MESSAGE_DB, env.RATE_LIMIT_HMAC_KEY);
  const imageCleanup = new D1ImageCleanupRepository(env.BOSS_MESSAGE_DB);
  const phoneCrypto = new WebCryptoPhoneService(env.PHONE_HASH_KEY, env.PHONE_ENCRYPTION_KEY);
  const otp = new OtpService({
    users,
    otp: otpRepository,
    rateLimits,
    phoneCrypto,
    sms: createSmsProvider(env),
    turnstile: new CloudflareTurnstileVerifier(
      env.TURNSTILE_SECRET_KEY,
      new Set((env.TURNSTILE_EXPECTED_HOSTNAMES ?? "").split(",").map((value) => value.trim()).filter(Boolean)),
      env.APP_ENV !== "production",
    ),
    otpHmacKey: env.OTP_HMAC_KEY,
    fixedDevelopmentCode: env.APP_ENV === "development" ? env.DEV_OTP_CODE : undefined,
  });
  return {
    otp,
    rateLimits,
    feedback: new FeedbackService({
      feedback: new D1FeedbackRepository(env.BOSS_MESSAGE_DB),
      imageCleanup,
      users,
      images: new R2ImageStorage(env.BOSS_MESSAGE_IMAGES),
      imageProcessor: new CloudflareImageProcessor(env.IMAGES),
      phoneCrypto,
      rateLimits,
      otp,
      privacyPolicyVersion: env.PRIVACY_POLICY_VERSION,
      livestreamPolicyVersion: env.LIVESTREAM_POLICY_VERSION,
    }),
  };
}

app.get("/api/config", (context) =>
  context.json({
    turnstileSiteKey: context.env.TURNSTILE_SITE_KEY,
    privacyPolicyVersion: context.env.PRIVACY_POLICY_VERSION,
    livestreamPolicyVersion: context.env.LIVESTREAM_POLICY_VERSION,
  }),
);

app.get("/api/health", (context) => context.json({ ok: true }));

app.post("/api/otp/request", async (context) => {
  const parsed = otpRequestSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    throw new PublicError(400, "VALIDATION_ERROR", "请检查填写内容", {
      fieldErrors: fieldErrors(parsed.error),
    });
  }
  const { otp, rateLimits } = createServices(context.env);
  const now = Date.now();
  context.executionCtx.waitUntil(rateLimits.deleteExpired(now));
  return context.json(
    await otp.request({ ...parsed.data, remoteIp: remoteIp(context.req.raw), now }),
  );
});

app.post("/api/feedback", async (context) => {
  const length = Number(context.req.header("Content-Length") ?? "0");
  if (Number.isFinite(length) && length > 7 * 1024 * 1024) {
    throw new PublicError(413, "IMAGE_INVALID", "上传内容过大，每张图片必须小于 2 MB");
  }
  const contentType = context.req.header("Content-Type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    throw new PublicError(400, "VALIDATION_ERROR", "提交格式无效");
  }
  const formData = await context.req.formData().catch(() => null);
  const rawPayload = formData?.get("payload");
  let payload: unknown = null;
  if (typeof rawPayload === "string") {
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      payload = null;
    }
  }
  const parsed = feedbackSubmissionSchema.safeParse(payload);
  if (!parsed.success) {
    throw new PublicError(400, "VALIDATION_ERROR", "请检查填写内容", {
      fieldErrors: fieldErrors(parsed.error),
    });
  }
  const imageFiles = (formData?.getAll("images") ?? []).filter(
    (value): value is File => value instanceof File,
  );
  const { feedback, rateLimits } = createServices(context.env);
  const now = Date.now();
  context.executionCtx.waitUntil(rateLimits.deleteExpired(now));
  return context.json(await feedback.submit({ fields: parsed.data, imageFiles, now }));
});

app.post("/api/history", async (context) => {
  const parsed = historyQuerySchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    throw new PublicError(400, "VALIDATION_ERROR", "请检查手机号和抖音昵称", {
      fieldErrors: fieldErrors(parsed.error),
    });
  }
  const { feedback, rateLimits } = createServices(context.env);
  const now = Date.now();
  context.executionCtx.waitUntil(rateLimits.deleteExpired(now));
  return context.json(
    await feedback.history({ ...parsed.data, remoteIp: remoteIp(context.req.raw), now }),
  );
});

app.notFound((context) => context.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "接口不存在" } }, 404));

app.onError((error, context) => {
  if (error instanceof PublicError) {
    if (error.options?.retryAfterSeconds) {
      context.header("Retry-After", String(error.options.retryAfterSeconds));
    }
    const body: ApiErrorBody = {
      ok: false,
      error: { code: error.code, message: error.message, ...error.options },
    };
    return context.json(body, error.status as 400);
  }
  console.error("Unhandled request error", {
    requestId: context.get("requestId"),
    kind: error instanceof Error ? error.name : "UnknownError",
  });
  return context.json<ApiErrorBody>(
    { ok: false, error: { code: "SERVER_ERROR", message: "服务暂时不可用，请稍后重试" } },
    500,
  );
});

export default {
  fetch: app.fetch,
  scheduled(_controller, env, context) {
    const cleanup = new ImageCleanupService(
      new D1ImageCleanupRepository(env.BOSS_MESSAGE_DB),
      new R2ImageStorage(env.BOSS_MESSAGE_IMAGES),
    );
    context.waitUntil(cleanup.run(Date.now()));
  },
} satisfies ExportedHandler<Env>;
