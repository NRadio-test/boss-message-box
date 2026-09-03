import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
  studioFeedbackViewSchema,
  studioLoginSchema,
  studioModeUpdateSchema,
  studioReplyCreateSchema,
  studioSearchSchema,
  type StudioSessionSuccess,
} from "../../src/shared/studio-contracts";
import { topicSchema } from "../../src/shared/contracts";
import { PublicError } from "../core/errors";
import type { StudioSessionRecord } from "../core/studio-ports";
import type { Env } from "../env";
import {
  D1AdminRepository,
  D1AdminSessionRepository,
  D1StudioRepository,
} from "../infra/d1-studio-repositories";
import { D1RateLimitService } from "../infra/d1-repositories";
import { R2ImageStorage } from "../infra/r2-image-storage";
import { WebCryptoPhoneService } from "../security/crypto";
import { Pbkdf2PasswordVerifier } from "../security/password";
import { StudioAuthService } from "../services/studio-auth-service";
import { StudioService } from "../services/studio-service";

const SESSION_COOKIE = "__Host-boss_studio_session";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

type StudioBindings = {
  Bindings: Env;
  Variables: {
    studioSession: StudioSessionRecord;
    studioToken: string;
  };
};

const feedbackIdSchema = z.string().uuid("留言标识无效");
const imageIdSchema = z.string().uuid("图片标识无效");
const listQuerySchema = z
  .object({
    view: studioFeedbackViewSchema.optional().default("unreplied"),
    topic: topicSchema.optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
    snapshotCreatedAt: z.coerce.number().int().nonnegative().optional(),
    snapshotId: z.string().uuid().optional(),
  })
  .superRefine((value, context) => {
    if ((value.snapshotCreatedAt === undefined) !== (value.snapshotId === undefined)) {
      context.addIssue({ code: "custom", message: "分页快照无效" });
    }
  });
const newFeedbackQuerySchema = z.object({
  afterCreatedAt: z.coerce.number().int().nonnegative(),
  afterId: z.string().uuid(),
  topic: topicSchema.optional(),
});

function services(env: Env): {
  auth: StudioAuthService;
  studio: StudioService;
  rateLimits: D1RateLimitService;
} {
  const rateLimits = new D1RateLimitService(env.BOSS_MESSAGE_DB, env.RATE_LIMIT_HMAC_KEY);
  const phoneCrypto = new WebCryptoPhoneService(env.PHONE_HASH_KEY, env.PHONE_ENCRYPTION_KEY);
  return {
    rateLimits,
    auth: new StudioAuthService({
      admins: new D1AdminRepository(env.BOSS_MESSAGE_DB),
      sessions: new D1AdminSessionRepository(env.BOSS_MESSAGE_DB),
      passwords: new Pbkdf2PasswordVerifier(),
      rateLimits,
    }),
    studio: new StudioService({
      studio: new D1StudioRepository(env.BOSS_MESSAGE_DB),
      images: new R2ImageStorage(env.BOSS_MESSAGE_IMAGES),
      phoneCrypto,
    }),
  };
}

function requestIp(request: Request): string | null {
  return request.headers.get("CF-Connecting-IP");
}

function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new PublicError(403, "FORBIDDEN", "请求来源无效");
  }
}

function validationError(error: z.ZodError): PublicError {
  return new PublicError(400, "VALIDATION_ERROR", error.issues[0]?.message ?? "请求参数无效", {
    fieldErrors: Object.fromEntries(
      error.issues.map((issue) => [String(issue.path[0] ?? "form"), issue.message]),
    ),
  });
}

function parseId(schema: typeof feedbackIdSchema, value: string): string;
function parseId(schema: typeof imageIdSchema, value: string): string;
function parseId(schema: z.ZodString, value: string): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}

export const studioRoutes = new Hono<StudioBindings>();

studioRoutes.post("/login", async (context) => {
  requireSameOrigin(context.req.raw);
  const parsed = studioLoginSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) throw validationError(parsed.error);
  const { auth, rateLimits } = services(context.env);
  const now = Date.now();
  context.executionCtx.waitUntil(rateLimits.deleteExpired(now));
  const result = await auth.login({
    ...parsed.data,
    remoteIp: requestIp(context.req.raw),
    now,
  });
  setCookie(context, SESSION_COOKIE, result.token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    expires: new Date(result.session.expiresAt),
  });
  return context.json(result.session);
});

studioRoutes.use("*", async (context, next) => {
  const token = getCookie(context, SESSION_COOKIE);
  const session = await services(context.env).auth.authenticate(token, Date.now());
  context.set("studioSession", session);
  context.set("studioToken", token!);
  await next();
});

studioRoutes.get("/session", (context) => {
  const session = context.get("studioSession");
  return context.json<StudioSessionSuccess>({
    ok: true,
    admin: session.admin,
    mode: session.mode,
    expiresAt: session.expiresAt,
  });
});

studioRoutes.post("/logout", async (context) => {
  requireSameOrigin(context.req.raw);
  await services(context.env).auth.logout(context.get("studioToken"));
  deleteCookie(context, SESSION_COOKIE, { path: "/", secure: true });
  return context.json({ ok: true as const });
});

studioRoutes.put("/session/mode", async (context) => {
  requireSameOrigin(context.req.raw);
  const parsed = studioModeUpdateSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) throw validationError(parsed.error);
  const session = await services(context.env).auth.setMode(
    context.get("studioToken"),
    parsed.data.mode,
    Date.now(),
  );
  context.set("studioSession", session);
  return context.json<StudioSessionSuccess>({
    ok: true,
    admin: session.admin,
    mode: session.mode,
    expiresAt: session.expiresAt,
  });
});

studioRoutes.get("/feedbacks", async (context) => {
  const parsed = listQuerySchema.safeParse(context.req.query());
  if (!parsed.success) throw validationError(parsed.error);
  return context.json(
    await services(context.env).studio.list({
      view: parsed.data.view,
      topic: parsed.data.topic ?? null,
      page: parsed.data.page,
      snapshot:
        parsed.data.snapshotCreatedAt === undefined
          ? null
          : { createdAt: parsed.data.snapshotCreatedAt, id: parsed.data.snapshotId! },
    }),
  );
});

studioRoutes.post("/search", async (context) => {
  requireSameOrigin(context.req.raw);
  const parsed = studioSearchSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) throw validationError(parsed.error);
  return context.json(
    await services(context.env).studio.search({
      query: parsed.data.query,
      page: parsed.data.page,
      snapshot: parsed.data.snapshot ?? null,
    }),
  );
});

studioRoutes.get("/feedbacks/:feedbackId", async (context) => {
  const feedbackId = parseId(feedbackIdSchema, context.req.param("feedbackId"));
  return context.json(await services(context.env).studio.feedback(feedbackId));
});

studioRoutes.post("/feedbacks/:feedbackId/replies", async (context) => {
  requireSameOrigin(context.req.raw);
  const feedbackId = parseId(feedbackIdSchema, context.req.param("feedbackId"));
  const parsed = studioReplyCreateSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) throw validationError(parsed.error);
  return context.json(
    await services(context.env).studio.reply({
      feedbackId,
      requestedType: parsed.data.replyType,
      content: parsed.data.content,
      session: context.get("studioSession"),
      now: Date.now(),
    }),
  );
});

studioRoutes.post("/feedbacks/:feedbackId/todo", async (context) => {
  requireSameOrigin(context.req.raw);
  const feedbackId = parseId(feedbackIdSchema, context.req.param("feedbackId"));
  return context.json(
    await services(context.env).studio.todo({
      feedbackId,
      isTodo: true,
      session: context.get("studioSession"),
      now: Date.now(),
    }),
  );
});

studioRoutes.delete("/feedbacks/:feedbackId/todo", async (context) => {
  requireSameOrigin(context.req.raw);
  const feedbackId = parseId(feedbackIdSchema, context.req.param("feedbackId"));
  return context.json(
    await services(context.env).studio.todo({
      feedbackId,
      isTodo: false,
      session: context.get("studioSession"),
      now: Date.now(),
    }),
  );
});

studioRoutes.get("/users/:userId", async (context) => {
  const userId = parseId(feedbackIdSchema, context.req.param("userId"));
  return context.json(await services(context.env).studio.user(userId));
});

studioRoutes.post("/users/:userId/reveal-phone", async (context) => {
  requireSameOrigin(context.req.raw);
  const userId = parseId(feedbackIdSchema, context.req.param("userId"));
  return context.json(
    await services(context.env).studio.revealPhone(userId, context.get("studioSession")),
  );
});

studioRoutes.get("/stats", async (context) =>
  context.json(await services(context.env).studio.stats(Date.now())),
);

studioRoutes.get("/new-feedback-count", async (context) => {
  const parsed = newFeedbackQuerySchema.safeParse(context.req.query());
  if (!parsed.success) throw validationError(parsed.error);
  return context.json(
    await services(context.env).studio.newFeedbackCount(
      {
        createdAt: parsed.data.afterCreatedAt,
        id: parsed.data.afterId,
      },
      parsed.data.topic ?? null,
    ),
  );
});

studioRoutes.get("/feedbacks/:feedbackId/images/:imageId", async (context) => {
  const feedbackId = parseId(feedbackIdSchema, context.req.param("feedbackId"));
  const imageId = parseId(imageIdSchema, context.req.param("imageId"));
  const object = await services(context.env).studio.image(feedbackId, imageId);
  const download = context.req.query("download") === "1";
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Type": "image/webp",
    "Content-Length": String(object.size),
    ETag: object.etag,
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${imageId}.webp"`,
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  });
  return new Response(object.body, { headers });
});
