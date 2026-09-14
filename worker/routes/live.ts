import { Hono } from "hono";
import { z } from "zod";
import { liveImportSchema, liveMoveSchema, liveRotateSchema, liveRoutingSchema } from "../../src/shared/live-contracts";
import { moveLiveEntry } from "../infra/d1-live-order";
import { topicSchema } from "../../src/shared/contracts";
import { PublicError } from "../core/errors";
import { D1LiveRepository } from "../infra/d1-live-repository";
import { createLiveImportService } from "../services/live-import-service";
import type { StudioBindings } from "./studio";
import { parseLiveWorkbook } from "../../src/shared/live-workbook";

const uuid = z.string().uuid();
const listSchema = z.object({ batchId: uuid.optional(), page: z.coerce.number().int().min(1).max(10_000).default(1) });
const entrySchema = z.object({ batchId: uuid });
const sequenceSchema = z.object({ batchId: uuid, currentId: uuid.optional(), direction: z.enum(["previous", "next"]).default("next") });
const retrySchema = z.object({ requestKey: uuid, rowNumbers: z.array(z.number().int().min(2).max(501)).min(1).max(500) }).strict();
const importRoutingListSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  topic: topicSchema.optional(),
});
const rowNumberSchema = z.coerce.number().int().min(2).max(501);
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new PublicError(400, "VALIDATION_ERROR", result.error.issues[0]?.message ?? "请求参数无效");
  return result.data;
}
async function readBytes(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  // Bound bytes actually read, including requests without Content-Length.
  if (Number(request.headers.get("Content-Length")) > limit) throw new PublicError(413, "VALIDATION_ERROR", "导入内容过大");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new PublicError(413, "VALIDATION_ERROR", "导入内容过大");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
async function json(request: Request): Promise<unknown> {
  const bytes = await readBytes(request, 4 * 1024 * 1024);
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}
async function readImport(request: Request) {
  const type = request.headers.get("Content-Type") ?? "";
  if (!type.startsWith("multipart/form-data;")) throw new PublicError(400, "VALIDATION_ERROR", "请选择 .xlsx 文件上传");
  const bytes = await readBytes(request, 3 * 1024 * 1024);
  let form: FormData;
  try { form = await new Response(bytes, { headers: { "Content-Type": type } }).formData(); }
  catch { throw new PublicError(400, "VALIDATION_ERROR", "上传格式无效"); }
  const file = form.get("file");
  const raw = form.get("payload");
  if (!(file instanceof File) || typeof raw !== "string" || raw.length > 1000 || form.getAll("file").length !== 1) throw new PublicError(400, "VALIDATION_ERROR", "上传文件无效");
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  const input = parse(z.object({ jobId: uuid, batchId: uuid, fileHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), payload);
  let preview;
  try { preview = await parseLiveWorkbook(file); }
  catch { throw new PublicError(400, "VALIDATION_ERROR", "工作簿校验失败，请检查文件格式、2 MiB 和 500 行上限"); }
  if (preview.fileHash !== input.fileHash) throw new PublicError(409, "REQUEST_CONFLICT", "上传文件与预览不一致，请重新选择文件");
  return parse(liveImportSchema, { ...input, filename: preview.filename, fileSize: preview.fileSize, rows: preview.rows });
}
export const liveRoutes = new Hono<StudioBindings>();
liveRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  if (c.req.method !== "GET") {
    if (c.req.header("Origin") !== new URL(c.req.url).origin) throw new PublicError(403, "FORBIDDEN", "请求来源无效");
    if (c.get("studioSession").mode !== "normal") throw new PublicError(403, "FORBIDDEN", "请先退出直播模式再操作");
  }
  await next();
});
liveRoutes.get("/active", async c => c.json({ ok: true, batch: await new D1LiveRepository(c.env.BOSS_MESSAGE_DB).batch() }));
liveRoutes.get("/batches", async c => {
  if (c.get("studioSession").mode !== "normal") throw new PublicError(403, "FORBIDDEN", "直播模式不能查看历史批次");
  return c.json({ ok: true, batches: await new D1LiveRepository(c.env.BOSS_MESSAGE_DB).batches() });
});
liveRoutes.get("/entries", async c => {
  const q = parse(listSchema, c.req.query());
  const repo = new D1LiveRepository(c.env.BOSS_MESSAGE_DB);
  const batch = await repo.batch(q.batchId);
  if (c.get("studioSession").mode === "live") await repo.requireActive(batch.id);
  return c.json(await repo.list(batch.id, q.page, c.get("studioSession").mode === "normal"));
});
liveRoutes.get("/entries/:entryId", async c => {
  const id = parse(uuid, c.req.param("entryId"));
  const q = parse(entrySchema, c.req.query());
  const repo = new D1LiveRepository(c.env.BOSS_MESSAGE_DB);
  if (c.get("studioSession").mode === "live") await repo.requireActive(q.batchId);
  return c.json({ ok: true, item: await repo.entry(id, q.batchId), batchId: q.batchId });
});
liveRoutes.get("/sequence", async c => {
  if (c.get("studioSession").mode !== "live") throw new PublicError(403, "FORBIDDEN", "请先进入直播模式");
  const q = parse(sequenceSchema, c.req.query());
  const id = await new D1LiveRepository(c.env.BOSS_MESSAGE_DB).sequence(q.batchId, q.currentId, q.direction);
  return c.json({ ok: true, batchId: q.batchId, feedbackId: id, nextFeedbackId: id });
});
liveRoutes.post("/routing/:feedbackId", async c => {
  const input = parse(liveRoutingSchema, await json(c.req.raw));
  await new D1LiveRepository(c.env.BOSS_MESSAGE_DB).route({ ...input, feedbackId: parse(uuid, c.req.param("feedbackId")), adminId: c.get("studioSession").admin.id, now: Date.now() });
  return c.json({ ok: true });
});
liveRoutes.post("/rotate", async c => {
  const input = parse(liveRotateSchema, await json(c.req.raw));
  const batch = await new D1LiveRepository(c.env.BOSS_MESSAGE_DB).rotate({ ...input, adminId: c.get("studioSession").admin.id, now: Date.now() });
  return c.json({ ok: true, batch });
});
liveRoutes.post("/routing/:feedbackId/remove", async c => {
  const input = parse(liveRotateSchema, await json(c.req.raw));
  await new D1LiveRepository(c.env.BOSS_MESSAGE_DB).removeFeedback({ ...input, feedbackId: parse(uuid, c.req.param("feedbackId")), adminId: c.get("studioSession").admin.id, now: Date.now() });
  return c.json({ ok: true });
});
liveRoutes.post("/entries/:entryId/remove", async c => {
  const input = parse(liveRotateSchema, await json(c.req.raw));
  await new D1LiveRepository(c.env.BOSS_MESSAGE_DB).remove({ ...input, entryId: parse(uuid, c.req.param("entryId")), adminId: c.get("studioSession").admin.id, now: Date.now() });
  return c.json({ ok: true });
});
liveRoutes.post("/entries/:entryId/move", async c => {
  const input = parse(liveMoveSchema, await json(c.req.raw));
  await moveLiveEntry(c.env.BOSS_MESSAGE_DB, { ...input, entryId: parse(uuid, c.req.param("entryId")),
    adminId: c.get("studioSession").admin.id, now: Date.now() });
  return c.json({ ok: true });
});
liveRoutes.use("/imports/*", async (c, next) => {
  if (c.get("studioSession").mode !== "normal") throw new PublicError(403, "FORBIDDEN", "请先退出直播模式再查看导入任务");
  await next();
});
liveRoutes.post("/imports", async c => {
  const service = createLiveImportService(c.env);
  const job = await service.create(await readImport(c.req.raw), c.get("studioSession").admin.id, Date.now());
  c.executionCtx.waitUntil(service.run());
  return c.json({ ok: true, job });
});
liveRoutes.get("/imports", async c => {
  if (c.get("studioSession").mode !== "normal") throw new PublicError(403, "FORBIDDEN", "请先退出直播模式再查看导入任务");
  const { batchId } = parse(entrySchema, c.req.query());
  return c.json({ ok: true, jobs: await createLiveImportService(c.env).jobs(batchId) });
});
liveRoutes.get("/imports/routing", async c => {
  const input = parse(importRoutingListSchema, c.req.query());
  return c.json(await createLiveImportService(c.env).routing(input.page, input.topic ?? null));
});
liveRoutes.post("/imports/:jobId/rows/:rowNumber/routing", async c => {
  const input = parse(liveRoutingSchema, await json(c.req.raw));
  await createLiveImportService(c.env).route({
    ...input,
    jobId: parse(uuid, c.req.param("jobId")),
    rowNumber: parse(rowNumberSchema, c.req.param("rowNumber")),
    adminId: c.get("studioSession").admin.id,
    now: Date.now(),
  });
  return c.json({ ok: true });
});
liveRoutes.get("/imports/:jobId", async c => c.json({ ok: true, job: await createLiveImportService(c.env).job(parse(uuid, c.req.param("jobId"))) }));
liveRoutes.post("/imports/:jobId/retry", async c => {
  const input = parse(retrySchema, await json(c.req.raw));
  const service = createLiveImportService(c.env);
  const job = await service.retry(parse(uuid, c.req.param("jobId")), input.requestKey, c.get("studioSession").admin.id, input.rowNumbers, Date.now());
  c.executionCtx.waitUntil(service.run());
  return c.json({ ok: true, job });
});
liveRoutes.post("/imports/:jobId/resume", async c => {
  const service = createLiveImportService(c.env);
  const job = await service.job(parse(uuid, c.req.param("jobId")));
  await new D1LiveRepository(c.env.BOSS_MESSAGE_DB).requireActive(job.batchId);
  c.executionCtx.waitUntil(service.run());
  return c.json({ ok: true });
});
