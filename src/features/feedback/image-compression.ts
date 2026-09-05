import { createRandomUuid } from "../../lib/random-id";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decodeImage(file: File, signal: AbortSignal): Promise<DecodedImage> {
  signal.throwIfAborted();
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (signal.aborted) {
        bitmap.close();
        signal.throwIfAborted();
      }
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      signal.throwIfAborted();
      // Some older WebViews expose createImageBitmap but cannot decode Blobs with options.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        image.onload = null;
        image.onerror = null;
        signal.removeEventListener("abort", cancel);
      };
      const cancel = () => {
        cleanup();
        image.src = "";
        reject(signal.reason);
      };
      image.onload = () => { cleanup(); resolve(); };
      image.onerror = () => { cleanup(); reject(new Error("浏览器无法读取这张图片")); };
      signal.addEventListener("abort", cancel, { once: true });
      image.src = objectUrl;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function compressOnMainThread(file: File, signal: AbortSignal): Promise<CompressedImage> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const image = await decodeImage(file, signal);
  const encode = async (maxEdge: number, quality: number): Promise<CompressedImage> => {
    const ratio = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * ratio));
    const height = Math.max(1, Math.round(image.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理这张图片");
    signal.throwIfAborted();
    context.drawImage(image.source, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) => {
          canvas.width = 0;
          canvas.height = 0;
          if (signal.aborted) reject(signal.reason);
          else if (result) resolve(result);
          else reject(new Error("浏览器无法压缩这张图片"));
        },
        "image/webp",
        quality,
      ),
    );
    return { blob, width, height };
  };
  try {
    return await encode(2560, 0.84);
  } finally {
    image.release();
  }
}

async function compressInWorker(file: File, signal: AbortSignal): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./image.worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener("abort", cancel);
    };
    const cancel = () => { cleanup(); reject(signal.reason); };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    const id = createRandomUuid();
    worker.onmessage = (event: MessageEvent<{ id: string; ok: boolean; blob?: Blob; width?: number; height?: number; message?: string }>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.ok && event.data.blob && event.data.width && event.data.height) {
        resolve({ blob: event.data.blob, width: event.data.width, height: event.data.height });
      } else {
        reject(new Error(event.data.message ?? "图片处理失败，请重新选择"));
      }
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error("图片处理失败，请重新选择"));
    };
    try { worker.postMessage({ id, file }); } catch (error) { cleanup(); reject(error); }
  });
}

export async function compressImage(file: File, signal?: AbortSignal): Promise<CompressedImage> {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error("仅支持 JPEG、PNG 或 WebP 图片");
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException("图片处理超时，请重新选择", "TimeoutError")), 30_000);
  let abortListener: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    abortListener = () => reject(controller.signal.reason);
    if (controller.signal.aborted) abortListener();
    else controller.signal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    const result = await Promise.race([(async () => {
      controller.signal.throwIfAborted();
      if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
        try {
          return await compressInWorker(file, controller.signal);
        } catch {
          controller.signal.throwIfAborted();
        }
      }
      return compressOnMainThread(file, controller.signal);
    })(), aborted]);
    if (result.blob.size <= 0) throw new Error("图片处理失败，请重新选择");
    return result;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", abortListener);
  }
}
