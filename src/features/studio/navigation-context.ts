export interface StudioReturnContext {
  url: string;
  anchorId?: string;
  neighborIds?: string[];
  anchorOffset?: number;
  search?: { query: string; page: number; snapshot?: { createdAt: number; id: string } | null };
}

const LIVE_RETURN_KEY = "boss-message-box:studio:live-return:v1";

export function captureReturnContext(
  url: string,
  anchorId: string,
  orderedIds: string[],
  element: HTMLElement | null,
): StudioReturnContext {
  const index = orderedIds.indexOf(anchorId);
  return {
    url,
    anchorId,
    neighborIds: orderedIds.slice(Math.max(0, index - 2), index + 3).filter((id) => id !== anchorId),
    anchorOffset: element?.getBoundingClientRect().top,
  };
}

export function saveLiveReturn(context: StudioReturnContext): void {
  try {
    sessionStorage.setItem(LIVE_RETURN_KEY, JSON.stringify(context));
  } catch {
    // Returning to the current route remains available even when storage is blocked.
  }
}

export function loadLiveReturn(): StudioReturnContext | null {
  try {
    const raw = sessionStorage.getItem(LIVE_RETURN_KEY);
    return raw ? (JSON.parse(raw) as StudioReturnContext) : null;
  } catch {
    return null;
  }
}

export function clearLiveReturn(): void {
  try {
    sessionStorage.removeItem(LIVE_RETURN_KEY);
  } catch {
    // No persistent state to clear.
  }
}

export function restoreListPosition(context: StudioReturnContext | null): void {
  if (!context) return;
  const candidates = [context.anchorId, ...(context.neighborIds ?? [])].filter(Boolean) as string[];
  const target = candidates
    .map((id) => document.querySelector<HTMLElement>(`[data-feedback-id="${CSS.escape(id)}"]`))
    .find(Boolean);
  if (!target) return;
  target.scrollIntoView({ block: "center" });
  if (typeof context.anchorOffset === "number") {
    window.scrollBy({ top: target.getBoundingClientRect().top - context.anchorOffset });
  }
}
