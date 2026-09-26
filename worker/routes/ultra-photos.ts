import { Hono } from "hono";
import { PublicError } from "../core/errors";
import { R2UltraPhotos } from "../infra/r2-ultra-photos";
import { readFeedbackForm } from "../security/feedback-body";
import type { StudioBindings } from "./studio";

export const ultraPhotoRoutes = new Hono<StudioBindings>();
ultraPhotoRoutes.get("/", async c => c.json({ ok: true, items: await new R2UltraPhotos(c.env.BOSS_MESSAGE_IMAGES).list() }));
ultraPhotoRoutes.post("/", async c => {
  if (c.req.header("Origin") !== new URL(c.req.url).origin || c.get("studioSession").mode !== "normal") {
    throw new PublicError(403, "FORBIDDEN", "请在普通 Studio 页面上传照片");
  }
  const form = await readFeedbackForm(c.req.raw);
  const file = form.get("photo");
  const id = form.get("requestKey");
  if (!(file instanceof File) || typeof id !== "string") throw new PublicError(400, "VALIDATION_ERROR", "请选择一张照片");
  const item = await new R2UltraPhotos(c.env.BOSS_MESSAGE_IMAGES).upload(file, id);
  return c.json({ ok: true, item });
});
ultraPhotoRoutes.get("/:photoId/image", async c => {
  const object = await new R2UltraPhotos(c.env.BOSS_MESSAGE_IMAGES).object(c.req.param("photoId"));
  if (!object) throw new PublicError(404, "NOT_FOUND", "照片不存在");
  const headers = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Length", String(object.size));
  headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
});
