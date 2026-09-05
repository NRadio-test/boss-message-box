import { PublicError } from "../core/errors";

// Infrastructure budget for the whole multipart request, not an image quality target.
export const MAX_FEEDBACK_BODY_BYTES = 32 * 1024 * 1024;

export async function readFeedbackForm(request: Request): Promise<FormData> {
  const tooLarge = () => new PublicError(413, "IMAGE_INVALID", "本次上传数据过大，请减少图片数量后重试");
  if (Number(request.headers.get("Content-Length")) > MAX_FEEDBACK_BODY_BYTES) throw tooLarge();
  if (!request.body) throw new PublicError(400, "VALIDATION_ERROR", "提交内容为空");
  const reader = request.body.getReader();
  let total = 0;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  let finished = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { streamController = controller; },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (finished) return;
        if (done) { finished = true; controller.close(); return; }
        total += value.byteLength;
        if (total > MAX_FEEDBACK_BODY_BYTES) throw tooLarge();
        controller.enqueue(value);
      } catch (error) {
        if (!finished) { finished = true; controller.error(error); }
        await reader.cancel().catch(() => undefined);
      }
    },
    cancel(reason) { finished = true; return reader.cancel(reason); },
  });
  const timeout = setTimeout(() => {
    if (finished) return;
    finished = true;
    streamController.error(new PublicError(408, "SUBMISSION_FAILED", "上传超时，请检查网络后重试"));
    void reader.cancel().catch(() => undefined);
  }, 45_000);
  try {
    return await new Response(stream, { headers: { "Content-Type": request.headers.get("Content-Type") ?? "" } }).formData();
  } catch (error) {
    if (error instanceof PublicError) throw error;
    throw new PublicError(400, "VALIDATION_ERROR", "提交格式无效，请重新选择图片后重试");
  } finally {
    clearTimeout(timeout);
    finished = true;
    void reader.cancel().catch(() => undefined);
  }
}
