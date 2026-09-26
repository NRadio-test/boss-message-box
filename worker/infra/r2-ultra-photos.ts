import { ULTRA_PHOTO_PREFIX, MAX_ULTRA_PHOTO_BYTES, photoSenderName, photoStoredName, photoOriginalName, type UltraPhoto } from "../../src/shared/ultra-photo-contracts";
import { PublicError } from "../core/errors";
import { sha256 } from "../security/crypto";

const validId = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
function photo(object: R2Object): UltraPhoto {
  const [id, storedName] = object.key.slice(ULTRA_PHOTO_PREFIX.length).split("/");
  const fileName = photoOriginalName(storedName!);
  return { id: id!, fileName: fileName!, senderName: photoSenderName(fileName!), uploadedAt: object.uploaded.getTime(),
    byteSize: object.size, imageUrl: `/api/studio/ultra-photos/${id}/image` };
}

function imageType(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) return "image/png";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "image/gif";
  return null;
}

export class R2UltraPhotos {
  constructor(private readonly bucket: R2Bucket) {}
  async list(): Promise<UltraPhoto[]> {
    const items: UltraPhoto[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix: ULTRA_PHOTO_PREFIX, limit: 1000, cursor });
      for (const object of page.objects) {
        const parts = object.key.slice(ULTRA_PHOTO_PREFIX.length).split("/");
        if (parts.length === 2 && validId.test(parts[0]!) && parts[1]) items.push(photo(object));
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return items.sort((a, b) => b.uploadedAt - a.uploadedAt || b.id.localeCompare(a.id));
  }
  async object(id: string): Promise<R2ObjectBody | null> {
    if (!validId.test(id)) throw new PublicError(400, "VALIDATION_ERROR", "照片标识无效");
    const found = await this.bucket.list({ prefix: `${ULTRA_PHOTO_PREFIX}${id}/`, limit: 1 });
    return found.objects[0] ? this.bucket.get(found.objects[0].key) : null;
  }
  async upload(file: File, id: string): Promise<UltraPhoto> {
    if (!validId.test(id)) throw new PublicError(400, "VALIDATION_ERROR", "上传标识无效，请重新选择照片");
    const invalidCharacter = Array.from(file.name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === "/" || char === "\\");
    if (!file.name || file.name.length > 255 || invalidCharacter || !photoSenderName(file.name).trim()) {
      throw new PublicError(400, "VALIDATION_ERROR", "照片文件名无效，请用发送者的名字命名");
    }
    if (!file.size || file.size > MAX_ULTRA_PHOTO_BYTES) throw new PublicError(413, "IMAGE_INVALID", "照片为空或超过 32 MB，请重新选择");
    const data = await file.arrayBuffer();
    const contentType = imageType(new Uint8Array(data));
    const extensions: Record<string, RegExp> = { "image/jpeg": /\.jpe?g$/i, "image/png": /\.png$/i, "image/webp": /\.webp$/i, "image/gif": /\.gif$/i };
    if (!contentType || !extensions[contentType]!.test(file.name)) throw new PublicError(400, "IMAGE_INVALID", "请选择 JPG、PNG、WebP 或 GIF 照片");
    const checksum = await sha256(data);
    const existing = await this.bucket.list({ prefix: `${ULTRA_PHOTO_PREFIX}${id}/`, limit: 1, include: ["customMetadata"] });
    if (existing.objects[0]) {
      if (photo(existing.objects[0]).fileName !== file.name || existing.objects[0].customMetadata?.sha256 !== checksum) {
        throw new PublicError(409, "REQUEST_CONFLICT", "上传标识已使用，请重新选择照片");
      }
      return photo(existing.objects[0]);
    }
    const key = `${ULTRA_PHOTO_PREFIX}${id}/${photoStoredName(file.name)}`;
    const result = await this.bucket.put(key, data, { httpMetadata: { contentType, cacheControl: "private, no-store" },
      customMetadata: { sha256: checksum }, onlyIf: { etagDoesNotMatch: "*" } });
    if (result) return photo(result);
    const saved = await this.bucket.head(key);
    if (saved?.customMetadata?.sha256 === checksum) return photo(saved);
    throw new PublicError(409, "REQUEST_CONFLICT", "照片上传状态已变化，请重试");
  }
}
