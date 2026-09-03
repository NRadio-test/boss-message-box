const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(value: string): Uint8Array<ArrayBuffer> {
  // TypeScript 7 models TextEncoder output as ArrayBufferLike. Copying keeps
  // the Web Crypto boundary explicitly ArrayBuffer-backed in every runtime.
  return new Uint8Array(encoder.encode(value));
}

export function utf8Decode(value: ArrayBuffer): string {
  return decoder.decode(value);
}

export function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function base64ToBytes(value: string, label: string): Uint8Array<ArrayBuffer> {
  try {
    const binary = atob(value.trim());
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.byteLength !== 32) throw new Error("invalid length");
    return bytes;
  } catch {
    throw new Error(`${label} 必须是 32 字节的 Base64 密钥`);
  }
}
