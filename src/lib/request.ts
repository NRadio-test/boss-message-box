/** Keeps the deadline active until the response body has finished loading. */
export async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 20_000,
): Promise<{ response: Response; body: T | null }> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const cancel = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) cancel();
  else externalSignal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => {
    controller.abort(new DOMException("请求超时，请检查网络后重试", "TimeoutError"));
  }, timeoutMs);
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason ?? new DOMException("请求已取消", "AbortError"));
    if (controller.signal.aborted) onAbort();
    else controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      (async () => {
        controller.signal.throwIfAborted();
        const response = await fetch(path, { ...init, signal: controller.signal });
        const body = await response.json().catch(() => null) as T | null;
        return { response, body };
      })(),
      aborted,
    ]);
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof TypeError) throw new Error("网络连接不稳定，请检查网络后重试", { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
