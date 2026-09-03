// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validatePrivateWebp } from "../../worker/security/image";

function writeAscii(target: Uint8Array<ArrayBuffer>, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index);
  }
}

function chunk(
  type: string,
  payload: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(8 + payload.length + (payload.length % 2));
  writeAscii(result, 0, type);
  new DataView(result.buffer).setUint32(4, payload.length, true);
  result.set(payload, 8);
  return result;
}

function webp(
  extraChunks: Uint8Array<ArrayBuffer>[] = [],
): Uint8Array<ArrayBuffer> {
  const vp8x = new Uint8Array(10);
  const vp8l = new Uint8Array([0x2f, 0, 0, 0, 0]);
  const chunks = [chunk("VP8X", vp8x), ...extraChunks, chunk("VP8L", vp8l)];
  const byteLength = 12 + chunks.reduce((total, value) => total + value.length, 0);
  const result = new Uint8Array(byteLength);
  writeAscii(result, 0, "RIFF");
  new DataView(result.buffer).setUint32(4, byteLength - 8, true);
  writeAscii(result, 8, "WEBP");
  let offset = 12;
  for (const value of chunks) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

describe("private image validation", () => {
  it("validates actual WebP bytes independently of the filename", async () => {
    const result = await validatePrivateWebp(
      new File([webp()], "misleading.jpg", { type: "image/jpeg" }),
    );
    expect(result).toMatchObject({ width: 1, height: 1, byteSize: 44 });
    expect(result.sha256).toBeTruthy();
  });

  it("rejects output that still contains EXIF metadata", async () => {
    const bytes = webp([chunk("EXIF", new Uint8Array([1, 2, 3, 4]))]);
    await expect(
      validatePrivateWebp(new File([bytes], "with-exif.webp", { type: "image/webp" })),
    ).rejects.toThrow("图片仍含元数据");
  });

  it("does not reject a valid image solely because its encoded bytes exceed 2 MiB", async () => {
    const bytes = webp([chunk("JUNK", new Uint8Array(2 * 1024 * 1024))]);
    const result = await validatePrivateWebp(
      new File([bytes], "large-valid.webp", { type: "image/webp" }),
    );
    expect(result.byteSize).toBeGreaterThan(2 * 1024 * 1024);
  });
});
