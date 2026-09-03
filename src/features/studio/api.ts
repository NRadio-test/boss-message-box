import type {
  StudioFeedbackDetailSuccess,
  StudioFeedbackListSuccess,
  StudioFeedbackView,
  StudioMode,
  StudioNewFeedbackCountSuccess,
  StudioPhoneRevealSuccess,
  StudioReplyCreateSuccess,
  StudioReplyType,
  StudioSearchSuccess,
  StudioSessionSuccess,
  StudioSnapshot,
  StudioStatsSuccess,
  StudioTodoSuccess,
  StudioUserDetailSuccess,
} from "../../shared/studio-contracts";

interface ErrorResponse {
  error?: { message?: string; fieldErrors?: Record<string, string>; retryAfterSeconds?: number };
}

export class StudioApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fieldErrors?: Record<string, string>,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "StudioApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as T | ErrorResponse | null;
  if (!response.ok || !body) {
    if (response.status === 401) window.dispatchEvent(new Event("studio:unauthorized"));
    const error = body && "error" in body ? body.error : undefined;
    throw new StudioApiError(
      error?.message ?? "网络连接不稳定，请稍后重试",
      response.status,
      error?.fieldErrors,
      error?.retryAfterSeconds,
    );
  }
  return body as T;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export function getStudioSession(signal?: AbortSignal): Promise<StudioSessionSuccess> {
  return request("/api/studio/session", { signal });
}

export function loginStudio(input: { username: string; password: string }): Promise<StudioSessionSuccess> {
  return request("/api/studio/login", jsonInit("POST", input));
}

export function logoutStudio(): Promise<{ ok: true }> {
  return request("/api/studio/logout", jsonInit("POST"));
}

export function updateStudioMode(mode: StudioMode): Promise<StudioSessionSuccess> {
  return request("/api/studio/session/mode", jsonInit("PUT", { mode }));
}

export function getStudioStats(signal?: AbortSignal): Promise<StudioStatsSuccess> {
  return request("/api/studio/stats", { signal });
}

export function getStudioFeedbacks(
  view: StudioFeedbackView,
  page: number,
  signal?: AbortSignal,
): Promise<StudioFeedbackListSuccess> {
  const query = new URLSearchParams({ view, page: String(page) });
  return request(`/api/studio/feedbacks?${query}`, { signal });
}

export function searchStudioFeedbacks(
  query: string,
  page: number,
  signal?: AbortSignal,
): Promise<StudioSearchSuccess> {
  return request("/api/studio/search", { ...jsonInit("POST", { query, page }), signal });
}

export function getStudioFeedback(
  feedbackId: string,
  signal?: AbortSignal,
): Promise<StudioFeedbackDetailSuccess> {
  return request(`/api/studio/feedbacks/${encodeURIComponent(feedbackId)}`, { signal });
}

export function createStudioReply(
  feedbackId: string,
  content: string,
  replyType?: StudioReplyType,
): Promise<StudioReplyCreateSuccess> {
  return request(
    `/api/studio/feedbacks/${encodeURIComponent(feedbackId)}/replies`,
    jsonInit("POST", { content, ...(replyType ? { replyType } : {}) }),
  );
}

export function updateStudioTodo(feedbackId: string, enabled: boolean): Promise<StudioTodoSuccess> {
  return request(
    `/api/studio/feedbacks/${encodeURIComponent(feedbackId)}/todo`,
    jsonInit(enabled ? "POST" : "DELETE"),
  );
}

export function getStudioUser(userId: string, signal?: AbortSignal): Promise<StudioUserDetailSuccess> {
  return request(`/api/studio/users/${encodeURIComponent(userId)}`, { signal });
}

export function revealStudioPhone(userId: string): Promise<StudioPhoneRevealSuccess> {
  return request(`/api/studio/users/${encodeURIComponent(userId)}/reveal-phone`, jsonInit("POST"));
}

export function getNewStudioFeedbackCount(
  snapshot: StudioSnapshot,
  signal?: AbortSignal,
): Promise<StudioNewFeedbackCountSuccess> {
  const query = new URLSearchParams({
    sinceCreatedAt: String(snapshot.createdAt),
    sinceId: snapshot.id,
  });
  return request(`/api/studio/new-feedback-count?${query}`, { signal });
}
