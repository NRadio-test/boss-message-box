import type { ImageStorage } from "../core/ports";

export class R2ImageStorage implements ImageStorage {
  constructor(private readonly bucket: R2Bucket) {}

  async putPrivate(
    key: string,
    data: ArrayBuffer,
    metadata: { feedbackId: string; sha256: string },
  ): Promise<void> {
    await this.bucket.put(key, data, {
      httpMetadata: { contentType: "image/webp", cacheControl: "private, no-store" },
      customMetadata: metadata,
    });
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
