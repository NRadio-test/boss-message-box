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

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Some older WebViews expose createImageBitmap but cannot decode Blobs with options.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("浏览器无法读取这张图片"));
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

async function compressOnMainThread(file: File): Promise<CompressedImage> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const image = await decodeImage(file);
  const encode = async (maxEdge: number, quality: number): Promise<CompressedImage> => {
    const ratio = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * ratio));
    const height = Math.max(1, Math.round(image.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理这张图片");
    context.drawImage(image.source, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("浏览器无法压缩这张图片"))),
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

async function compressInWorker(file: File): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./image.worker.ts", import.meta.url), { type: "module" });
    const id = createRandomUuid();
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
}

export async function compressImage(file: File): Promise<CompressedImage> {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error("仅支持 JPEG、PNG 或 WebP 图片");
  let result: CompressedImage;
  if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
    try {
      result = await compressInWorker(file);
    } catch {
      result = await compressOnMainThread(file);
    }
  } else {
    result = await compressOnMainThread(file);
  }
  if (result.blob.size <= 0) throw new Error("图片处理失败，请重新选择");
  return result;
}
