import type {
  LiveBatch,
  LiveEntry,
  LiveImportInput,
  LiveImportJob,
  LiveImportRoutingListSuccess,
  LiveListSuccess,
  LiveMoveInput,
} from "../../shared/live-contracts";
import type { Topic } from "../../shared/contracts";
import { studioRequest } from "./api";
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const getActiveBatch = (signal?: AbortSignal) => studioRequest<{ ok: true; batch: LiveBatch }>("/api/studio/live/active", { signal });
export const getLiveBatches = (signal?: AbortSignal) => studioRequest<{ ok: true; batches: LiveBatch[] }>("/api/studio/live/batches", { signal });
export const getLiveEntries = (batchId: string | null, page = 1, signal?: AbortSignal) => studioRequest<LiveListSuccess>(
  `/api/studio/live/entries?${new URLSearchParams({ page: String(page), ...(batchId ? { batchId } : {}) })}`, { signal });
export const getLiveEntry = (id: string, batchId: string, signal?: AbortSignal) => studioRequest<{ ok: true; item: LiveEntry; batchId: string }>(
  `/api/studio/live/entries/${encodeURIComponent(id)}?${new URLSearchParams({ batchId })}`, { signal });
export const getLiveSequence = (batchId: string, currentId?: string, direction: "previous" | "next" = "next", signal?: AbortSignal) =>
  studioRequest<{ ok: true; batchId: string; feedbackId: string | null; nextFeedbackId: string | null }>(
    `/api/studio/live/sequence?${new URLSearchParams({ batchId, direction, ...(currentId ? { currentId } : {}) })}`, { signal });
export async function routeLiveFeedback(id: string, input: { batchId: string; requestKey: string; routingStatus: "selected" | "not_selected" }) {
  const result = await studioRequest<{ ok: true }>(`/api/studio/live/routing/${encodeURIComponent(id)}`, post(input));
  window.dispatchEvent(new Event("studio:changed"));
  return result;
}
export async function removeLiveFeedback(feedbackId: string, input: { batchId: string; requestKey: string }) {
  const result = await studioRequest<{ ok: true }>(`/api/studio/live/routing/${encodeURIComponent(feedbackId)}/remove`, post(input));
  window.dispatchEvent(new Event("studio:changed"));
  return result;
}
export async function rotateLiveBatch(batchId: string, requestKey: string) {
  const result = await studioRequest<{ ok: true; batch: LiveBatch }>("/api/studio/live/rotate", post({ batchId, requestKey }));
  window.dispatchEvent(new Event("studio:batch-changed"));
  return result;
}
export const removeLiveEntry = (entryId: string, batchId: string, requestKey: string) => studioRequest<{ ok: true }>(
  `/api/studio/live/entries/${encodeURIComponent(entryId)}/remove`, post({ batchId, requestKey }));
export const moveLiveEntry = (entryId: string, input: LiveMoveInput) => studioRequest<{ ok: true }>(
  `/api/studio/live/entries/${encodeURIComponent(entryId)}/move`, post(input));
export const createLiveImport = (input: LiveImportInput, file: File) => {
  const form = new FormData();
  form.set("file", file);
  form.set("payload", JSON.stringify({ jobId: input.jobId, batchId: input.batchId, fileHash: input.fileHash }));
  return studioRequest<{ ok: true; job: LiveImportJob }>("/api/studio/live/imports", { method: "POST", body: form });
};
export const getLiveImportJobs = (batchId: string, signal?: AbortSignal) => studioRequest<{ ok: true; jobs: Array<Pick<LiveImportJob, "id" | "filename" | "createdAt" | "batchId">> }>(
  `/api/studio/live/imports?${new URLSearchParams({ batchId })}`, { signal });
export const getLiveImportRouting = (page = 1, topic: Topic | null = null, signal?: AbortSignal) => studioRequest<LiveImportRoutingListSuccess>(
  `/api/studio/live/imports/routing?${new URLSearchParams({ page: String(page), ...(topic ? { topic } : {}) })}`, { signal });
export async function routeLiveImportRow(jobId: string, rowNumber: number, input: { batchId: string; requestKey: string; routingStatus: "selected" | "not_selected" }) {
  const result = await studioRequest<{ ok: true }>(
    `/api/studio/live/imports/${encodeURIComponent(jobId)}/rows/${rowNumber}/routing`, post(input));
  window.dispatchEvent(new Event("studio:changed"));
  return result;
}
export const getLiveImportJob = (id: string, signal?: AbortSignal) => studioRequest<{ ok: true; job: LiveImportJob }>(`/api/studio/live/imports/${encodeURIComponent(id)}`, { signal });
export const retryLiveImport = (id: string, rowNumbers: number[], requestKey: string) => studioRequest<{ ok: true; job: LiveImportJob }>(
  `/api/studio/live/imports/${encodeURIComponent(id)}/retry`, post({ rowNumbers, requestKey }));
export const resumeLiveImport = (id: string) => studioRequest<{ ok: true }>(`/api/studio/live/imports/${encodeURIComponent(id)}/resume`, post({}));
