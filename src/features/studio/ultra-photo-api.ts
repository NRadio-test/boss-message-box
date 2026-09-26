import { studioRequest } from "./api";
import type { UltraPhoto, UltraPhotoList } from "../../shared/ultra-photo-contracts";

export const getUltraPhotos = (signal?: AbortSignal) => studioRequest<UltraPhotoList>("/api/studio/ultra-photos", { signal });
export const uploadUltraPhoto = (file: File, requestKey: string) => {
  const form = new FormData(); form.set("photo", file); form.set("requestKey", requestKey);
  return studioRequest<{ ok: true; item: UltraPhoto }>("/api/studio/ultra-photos", { method: "POST", body: form });
};
