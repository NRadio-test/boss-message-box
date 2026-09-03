import type { ImageProcessor, ProcessedImage } from "../core/ports";
import { MAX_IMAGE_BYTES, validatePrivateWebp } from "../security/image";

const MAX_SOURCE_PIXELS = 20_000_000;
const MAX_SOURCE_EDGE = 8192;
const TARGET_EDGE = 2560;

export class CloudflareImageProcessor implements ImageProcessor {
  constructor(private readonly images: ImagesBinding) {}

  async sanitize(file: File): Promise<ProcessedImage> {
    if (file.size <= 0 || file.size >= MAX_IMAGE_BYTES) {
      throw new Error("每张图片必须小于 2 MB");
    }
    const source = await file.arrayBuffer();
    const info = await this.images.info(new Blob([source]).stream());
    if (
      (info.format !== "image/jpeg" && info.format !== "image/png" && info.format !== "image/webp") ||
      !("width" in info) ||
      !("height" in info)
    ) {
      throw new Error("仅支持 JPEG、PNG 或 WebP 图片");
    }
    if (
      info.width < 1 ||
      info.height < 1 ||
      info.width > MAX_SOURCE_EDGE ||
      info.height > MAX_SOURCE_EDGE ||
      info.width * info.height > MAX_SOURCE_PIXELS
    ) {
      throw new Error("图片尺寸超出支持范围");
    }

    const first = await this.encode(source, info.width, info.height, TARGET_EDGE, 84);
    if (first.byteLength < MAX_IMAGE_BYTES) return this.validateOutput(first);

    const fallback = await this.encode(source, info.width, info.height, 2048, 74);
    if (fallback.byteLength >= MAX_IMAGE_BYTES) throw new Error("图片压缩后仍超过 2 MB，请换一张图片");
    return this.validateOutput(fallback);
  }

  private async encode(
    source: ArrayBuffer,
    width: number,
    height: number,
    maxEdge: number,
    quality: number,
  ): Promise<ArrayBuffer> {
    const ratio = Math.min(1, maxEdge / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * ratio));
    const targetHeight = Math.max(1, Math.round(height * ratio));
    const response = (
      await this.images
        .input(new Blob([source]).stream())
        .transform({ width: targetWidth, height: targetHeight, fit: "scale-down" })
        .output({ format: "image/webp", quality, anim: false })
    ).response();
    if (!response.ok) throw new Error("图片处理失败，请稍后重试");
    return response.arrayBuffer();
  }

  private validateOutput(data: ArrayBuffer): Promise<ProcessedImage> {
    return validatePrivateWebp(new File([data], "sanitized.webp", { type: "image/webp" }));
  }
}
