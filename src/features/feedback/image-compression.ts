const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
}

async function compressOnMainThread(file: File): Promise<CompressedImage> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const encode = async (maxEdge: number, quality: number): Promise<CompressedImage> => {
    const ratio = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * ratio));
    const height = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理这张图片");
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("浏览器无法压缩这张图片"))),
        "image/webp",
        quality,
      ),
    );
    return { blob, width, height };
  };
  let result = await encode(2560, file.size < 900_000 ? 0.92 : 0.84);
  if (result.blob.size >= MAX_BYTES || (file.size > 2_000_000 && result.blob.size > 1_250_000)) {
    result = await encode(2048, 0.74);
  }
  bitmap.close();
  return result;
}

export async function compressImage(file: File): Promise<CompressedImage> {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error("仅支持 JPEG、PNG 或 WebP 图片");
  let result: CompressedImage;
  if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
    result = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./image.worker.ts", import.meta.url), { type: "module" });
      const id = crypto.randomUUID();
      worker.onmessage = (event: MessageEvent<{ id: string; ok: boolean; blob?: Blob; width?: number; height?: number; message?: string }>) => {
        if (event.data.id !== id) return;
        worker.terminate();
        if (event.data.ok && event.data.blob && event.data.width && event.data.height) {
          resolve({ blob: event.data.blob, width: event.data.width, height: event.data.height });
        } else {
          reject(new Error(event.data.message ?? "图片处理失败，请重新选择"));
        }
      };
      worker.onerror = () => {
        worker.terminate();
        reject(new Error("图片处理失败，请重新选择"));
      };
      worker.postMessage({ id, file });
    });
  } else {
    result = await compressOnMainThread(file);
  }
  if (result.blob.size <= 0 || result.blob.size >= MAX_BYTES) {
    throw new Error("图片压缩后仍超过 2 MB，请换一张图片");
  }
  return result;
}
