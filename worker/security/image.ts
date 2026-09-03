import { sha256 } from "./crypto";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_COUNT = 3;

export interface ValidatedImage {
  data: ArrayBuffer;
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
}

function fourCc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function readDimensions(bytes: Uint8Array, chunkType: string, dataOffset: number): [number, number] {
  if (chunkType === "VP8X" && dataOffset + 10 <= bytes.length) {
    return [uint24le(bytes, dataOffset + 4) + 1, uint24le(bytes, dataOffset + 7) + 1];
  }
  if (chunkType === "VP8L" && dataOffset + 5 <= bytes.length && bytes[dataOffset] === 0x2f) {
    const b1 = bytes[dataOffset + 1]!;
    const b2 = bytes[dataOffset + 2]!;
    const b3 = bytes[dataOffset + 3]!;
    const b4 = bytes[dataOffset + 4]!;
    return [1 + (((b2 & 0x3f) << 8) | b1), 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))];
  }
  if (
    chunkType === "VP8 " &&
    dataOffset + 10 <= bytes.length &&
    bytes[dataOffset + 3] === 0x9d &&
    bytes[dataOffset + 4] === 0x01 &&
    bytes[dataOffset + 5] === 0x2a
  ) {
    const width = (bytes[dataOffset + 6]! | (bytes[dataOffset + 7]! << 8)) & 0x3fff;
    const height = (bytes[dataOffset + 8]! | (bytes[dataOffset + 9]! << 8)) & 0x3fff;
    return [width, height];
  }
  throw new Error("无法读取图片尺寸");
}

export async function validatePrivateWebp(file: File): Promise<ValidatedImage> {
  if (file.size <= 0 || file.size >= MAX_IMAGE_BYTES) throw new Error("每张图片必须小于 2 MB");
  const data = await file.arrayBuffer();
  const bytes = new Uint8Array(data);
  if (
    bytes.length < 30 ||
    fourCc(bytes, 0) !== "RIFF" ||
    fourCc(bytes, 8) !== "WEBP" ||
    new DataView(data).getUint32(4, true) + 8 !== bytes.length
  ) {
    throw new Error("图片内容无效，请重新选择");
  }

  let offset = 12;
  let dimensions: [number, number] | null = null;
  let imageChunkCount = 0;
  while (offset + 8 <= bytes.length) {
    const chunkType = fourCc(bytes, offset);
    const chunkSize = new DataView(data).getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + chunkSize + (chunkSize % 2);
    if (nextOffset > bytes.length) throw new Error("图片结构不完整");
    if (["EXIF", "XMP ", "ICCP", "ANIM", "ANMF"].includes(chunkType)) {
      throw new Error("图片仍含元数据或动画，请重新压缩后上传");
    }
    if (["VP8X", "VP8L", "VP8 "].includes(chunkType) && dimensions === null) {
      dimensions = readDimensions(bytes, chunkType, dataOffset);
    }
    if (["VP8L", "VP8 "].includes(chunkType)) imageChunkCount += 1;
    offset = nextOffset;
  }
  if (offset !== bytes.length || !dimensions || imageChunkCount !== 1) {
    throw new Error("图片内容无效，请重新选择");
  }
  const [width, height] = dimensions;
  if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 40_000_000) {
    throw new Error("图片尺寸超出支持范围");
  }

  return { data, byteSize: bytes.length, width, height, sha256: await sha256(data) };
}
