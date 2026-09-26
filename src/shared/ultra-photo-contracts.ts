export const ULTRA_PHOTO_PREFIX = "studio/ultra-arrivals/";
export const ULTRA_PHOTO_ACCEPT = ".jpg,.jpeg,.png,.webp,.gif";
export const MAX_ULTRA_PHOTO_BYTES = 32 * 1024 * 1024 - 65_536;

export interface UltraPhoto {
  id: string;
  fileName: string;
  senderName: string;
  uploadedAt: number;
  byteSize: number;
  imageUrl: string;
}
export interface UltraPhotoList { ok: true; items: UltraPhoto[] }

export function photoSenderName(fileName: string): string {
  return fileName.replace(/\.(?:jpe?g|png|webp|gif)$/i, "");
}

// Keep Unicode/original filenames in the UI without putting punctuation into API paths.
export function photoStoredName(fileName: string): string {
  return "name~" + btoa(String.fromCharCode(...new TextEncoder().encode(fileName))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function photoOriginalName(storedName: string): string {
  if (!storedName.startsWith("name~")) return storedName;
  const bytes = Uint8Array.from(atob(storedName.slice(5).replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
}
