import { TOPIC_VALUES, type Topic } from "../../shared/contracts";
import { createRandomUuid } from "../../lib/random-id";

const DRAFT_KEY = "boss-message-box:draft:v1";
const OTP_KEY = "boss-message-box:otp:v1";
const IDENTITY_KEY = "boss-message-box:identity:v1";
const COMPLETED_KEY = "boss-message-box:completed-drafts:v1";
const completedInMemory = new Set<string>();
const DB_NAME = "boss-message-box-drafts";
const IMAGE_STORE = "images";

export interface DraftState {
  submissionKey: string;
  submissionPending?: boolean;
  submissionImageCount?: number;
  imagesVersion?: number;
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
  submissionKey?: string;
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
  imagesVersion: 2,
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
    if (stored.submissionKey && isCompleted(stored.submissionKey)) return null;
    return {
      submissionKey: typeof stored.submissionKey === "string" ? stored.submissionKey : createRandomUuid(),
      submissionPending: stored.submissionPending === true,
      submissionImageCount: typeof stored.submissionImageCount === "number" ? stored.submissionImageCount : 0,
      imagesVersion: stored.imagesVersion === 2 ? 2 : 1,
      topic: TOPIC_VALUES.includes(stored.topic as Topic) ? stored.topic! : "",
      customTopic: typeof stored.customTopic === "string" ? stored.customTopic : null,
      content: typeof stored.content === "string" ? stored.content : "",
      nickname: typeof stored.nickname === "string" ? stored.nickname : "",
      imagesEnabled: stored.imagesEnabled === true,
      privacyAgreed: stored.privacyAgreed === true,
      livestreamAgreed: stored.livestreamAgreed === true,
      updatedAt: typeof stored.updatedAt === "number" ? stored.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

function isCompleted(key: string): boolean {
  if (completedInMemory.has(key)) return true;
  for (const storageName of ["localStorage", "sessionStorage"] as const) {
    try {
      const stored = JSON.parse(window[storageName].getItem(COMPLETED_KEY) ?? "[]") as unknown;
      if (Array.isArray(stored) && stored.includes(key)) return true;
    } catch { /* Browser storage is optional. */ }
  }
  return false;
}

export function markDraftSubmitted(key: string): void {
  completedInMemory.add(key);
  for (const storageName of ["localStorage", "sessionStorage"] as const) {
    try {
      const storage = window[storageName];
      const previous: unknown = JSON.parse(storage.getItem(COMPLETED_KEY) ?? "[]");
      const keys = Array.isArray(previous) ? previous.filter((item) => typeof item === "string") : [];
      storage.setItem(COMPLETED_KEY, JSON.stringify([...new Set([...keys, key])].slice(-50)));
    } catch { /* The in-memory marker still prevents stale debounce writes. */ }
  }
}

export function saveDraft(draft: DraftState): boolean {
  if (isCompleted(draft.submissionKey)) return false;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, updatedAt: Date.now() }));
    return true;
  } catch { return false; }
}

export function clearDraftFields(): void {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* Draft persistence is optional. */ }
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
  try { localStorage.setItem(IDENTITY_KEY, JSON.stringify({ nickname })); } catch { /* Optional shortcut. */ }
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
    const request = indexedDB.open(DB_NAME, 2);
    let expired = false;
    const timeout = setTimeout(() => {
      expired = true;
      reject(new Error("本地图片草稿暂时无法打开"));
    }, 5_000);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IMAGE_STORE)) {
        request.result.createObjectStore(IMAGE_STORE, { keyPath: "id" });
      }
      const store = request.transaction!.objectStore(IMAGE_STORE);
      if (!store.indexNames.contains("submissionKey")) store.createIndex("submissionKey", "submissionKey");
    };
    request.onsuccess = () => {
      clearTimeout(timeout);
      if (expired) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timeout);
      reject(request.error ?? new Error("无法打开本地图片草稿"));
    };
    request.onblocked = () => {
      expired = true;
      clearTimeout(timeout);
      reject(new Error("本地图片草稿暂时被其他页面占用"));
    };
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
    const timeout = setTimeout(() => {
      transaction.abort();
      reject(new Error("本地图片草稿操作超时"));
    }, 5_000);
    transaction.oncomplete = () => {
      clearTimeout(timeout);
      database.close();
      resolve(request.result);
    };
    const failed = () => {
      clearTimeout(timeout);
      database.close();
      reject(transaction.error ?? request.error ?? new Error("本地图片草稿操作失败"));
    };
    transaction.onerror = failed;
    transaction.onabort = failed;
  });
}

export function saveDraftImage(image: DraftImage): Promise<IDBValidKey> {
  return withStore("readwrite", (store) => store.put(image));
}

export function deleteDraftImage(id: string): Promise<undefined> {
  return withStore("readwrite", (store) => store.delete(id)) as Promise<undefined>;
}

export async function loadDraftImages(submissionKey?: string, migrateLegacy = false): Promise<DraftImage[]> {
  const images = await withStore<DraftImage[]>("readonly", (store) => submissionKey && !migrateLegacy
    ? store.index("submissionKey").getAll(submissionKey) : store.getAll());
  if (!submissionKey) return images;
  if (migrateLegacy) {
    for (const image of images.filter((image) => !image.submissionKey)) {
      image.submissionKey = submissionKey;
      await saveDraftImage(image);
    }
  }
  return images.filter((image) => image.submissionKey === submissionKey);
}

export async function clearDraftImages(submissionKey?: string): Promise<void> {
  if (!submissionKey) {
    await withStore("readwrite", (store) => store.clear());
    return;
  }
  const images = await loadDraftImages(submissionKey);
  await Promise.all(images.map((image) => deleteDraftImage(image.id)));
}
