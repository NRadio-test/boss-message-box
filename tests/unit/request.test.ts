// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { requestJson } from "../../src/lib/request";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("keeps its deadline active while the JSON body is stalled", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new ReadableStream()));
  const assertion = expect(requestJson("https://example.test", {}, 100)).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(101);
  await assertion;
  expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true);
});

it("does not fetch when the caller already cancelled", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const controller = new AbortController();
  controller.abort();
  await expect(requestJson("https://example.test", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("uses a readable error for network failures", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
  await expect(requestJson("https://example.test")).rejects.toThrow("网络连接不稳定");
});
