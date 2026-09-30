import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useProbes } from "../../src/features/iptest/use-probes";
import type { Target } from "../../src/features/iptest/probe";
const targets: Target[] = Array.from({ length: 9 }, (_, index) => ({ id: String(index), name: String(index), domain: "example.com", path: "/", method: "site", kind: "custom" }));
afterEach(() => vi.unstubAllGlobals());

it("limits concurrency, stops queued work, and ignores late results from the old run", async () => {
  const pending: ((response: object) => void)[] = [];
  const fetcher = vi.fn(() => new Promise((resolve) => pending.push(resolve)));
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(useProbes);
  act(() => { void result.current.run(targets, true); });
  expect(fetcher).toHaveBeenCalledTimes(6);
  act(() => result.current.stop());
  expect(Object.values(result.current.results).every((row) => row.status === "stopped")).toBe(true);
  fetcher.mockImplementation(() => Promise.resolve({ type: "opaque", status: 0 }));
  await act(async () => { await result.current.run([targets[0]!], true); });
  expect(Object.keys(result.current.results)).toEqual(["0"]);
  await act(async () => { pending.forEach((resolve) => resolve({ type: "opaque", status: 0 })); });
  expect(Object.keys(result.current.results)).toEqual(["0"]);
  expect(fetcher).toHaveBeenCalledTimes(7);
  expect(result.current.running).toBe(false);
});
it("aborts active network requests on unmount", async () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
    signal = options.signal as AbortSignal;
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  })));
  const { result, unmount } = renderHook(useProbes);
  act(() => { void result.current.run([targets[0]!]); });
  unmount();
  await waitFor(() => expect(signal?.aborted).toBe(true));
});
it("shows exit IP immediately, shares geo work, and preserves IP when geo fails", async () => {
  let finishGeo!: (response: Response) => void;
  const fetcher = vi.fn((url: string | URL) => {
    if (String(url).startsWith("/api/iptest/geo")) return new Promise<Response>((resolve) => { finishGeo = resolve; });
    return Promise.resolve(Object.defineProperty(new Response("1.1.1.1"), "url", { value: "https://example.com/" }));
  });
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(useProbes);
  act(() => { void result.current.run(targets.slice(0, 2).map((t) => ({ ...t, method: "echo" }))); });
  await waitFor(() => expect(result.current.results["1"]).toMatchObject({ ip: "1.1.1.1", geoStatus: "loading" }));
  expect(fetcher).toHaveBeenCalledTimes(3);
  await act(async () => finishGeo(new Response(null, { status: 503 })));
  await waitFor(() => expect(result.current.running).toBe(false));
  expect(result.current.results["1"]).toMatchObject({ status: "ok", ip: "1.1.1.1", geoStatus: "unavailable" });
});
