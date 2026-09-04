import type { Topic } from "../../shared/contracts";
import { createRandomUuid } from "../../lib/random-id";

const DRAFT_KEY = "boss-message-box:draft:v1";
const OTP_KEY = "boss-message-box:otp:v1";
const IDENTITY_KEY = "boss-message-box:identity:v1";
const DB_NAME = "boss-message-box-drafts";
const IMAGE_STORE = "images";

export interface DraftState {
  submissionKey: string;
  topic: Topic | "";
  customTopic: string | null;
  content: string;
  nickname: string;
  imagesEnabled: boolean;
  privacyAgreed: boolean;
  livestreamAgreed: boolean;
  updatedAt: number;
}

export interface DraftImage {
  id: string;
  blob: Blob;
  name: string;
  width: number;
  height: number;
  byteSize: number;
}

export interface OtpSession {
  phone: string;
  nickname: string;
  challengeId: string | null;
  maskedPhone: string;
  expiresAt: number;
  cooldownEndsAt: number;
  serverOffsetMs: number;
}

export const EMPTY_DRAFT = (): DraftState => ({
  submissionKey: createRandomUuid(),
  topic: "",
  customTopic: null,
  content: "",
  nickname: "",
  imagesEnabled: false,
  privacyAgreed: false,
  livestreamAgreed: false,
  updatedAt: Date.now(),
});

export function loadDraft(): DraftState | null {
  try {
    const value = localStorage.getItem(DRAFT_KEY);
    if (!value) return null;
    const stored = JSON.parse(value) as Partial<DraftState>;
    return {
      submissionKey: typeof stored.submissionKey === "string" ? stored.submissionKey : createRandomUuid(),
      topic: stored.topic ?? "",
      customTopic: stored.customTopic ?? null,
      content: stored.content ?? "",
      nickname: stored.nickname ?? "",
      imagesEnabled: stored.imagesEnabled ?? false,
      privacyAgreed: stored.privacyAgreed ?? false,
      livestreamAgreed: stored.livestreamAgreed ?? false,
      updatedAt: stored.updatedAt ?? Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveDraft(draft: DraftState): void {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, updatedAt: Date.now() }));
}

export function clearDraftFields(): void {
  localStorage.removeItem(DRAFT_KEY);
}

export function saveOtpSession(session: OtpSession): void {
  localStorage.setItem(OTP_KEY, JSON.stringify(session));
}

export function loadOtpSession(): OtpSession | null {
  try {
    const value = localStorage.getItem(OTP_KEY);
    return value ? (JSON.parse(value) as OtpSession) : null;
  } catch {
    return null;
  }
}

export function clearOtpSession(): void {
  localStorage.removeItem(OTP_KEY);
}

export function saveIdentity(nickname: string): void {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify({ nickname }));
}

export function loadIdentity(): { nickname: string } | null {
  try {
    const value = localStorage.getItem(IDENTITY_KEY);
    if (!value) return null;
    const stored = JSON.parse(value) as { nickname?: unknown };
    return typeof stored.nickname === "string" ? { nickname: stored.nickname } : null;
  } catch {
    return null;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IMAGE_STORE)) {
        request.result.createObjectStore(IMAGE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地图片草稿"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(IMAGE_STORE, mode);
    const request = operation(transaction.objectStore(IMAGE_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本地图片草稿操作失败"));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error ?? new Error("本地图片草稿操作失败"));
  });
}

export function saveDraftImage(image: DraftImage): Promise<IDBValidKey> {
  return withStore("readwrite", (store) => store.put(image));
}

export function deleteDraftImage(id: string): Promise<undefined> {
  return withStore("readwrite", (store) => store.delete(id)) as Promise<undefined>;
}

export function loadDraftImages(): Promise<DraftImage[]> {
  return withStore("readonly", (store) => store.getAll());
}

export function clearDraftImages(): Promise<undefined> {
  return withStore("readwrite", (store) => store.clear()) as Promise<undefined>;
}
