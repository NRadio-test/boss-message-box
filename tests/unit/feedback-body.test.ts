// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_FEEDBACK_BODY_BYTES, readFeedbackForm } from "../../worker/security/feedback-body";

afterEach(() => vi.useRealTimers());

describe("multipart resource budget", () => {
  it("accepts a processed image above 2 MiB", async () => {
    const form = new FormData();
    form.set("payload", "{}");
    form.set("images", new File([new Uint8Array(3 * 1024 * 1024)], "image.webp", { type: "image/webp" }));
    const result = await readFeedbackForm(new Request("https://example.test/api/feedback", { method: "POST", body: form }));
    expect((result.get("images") as File).size).toBe(3 * 1024 * 1024);
  });

  it("rejects an oversized declared request before reading it", async () => {
    const request = new Request("https://example.test/api/feedback", { method: "POST", headers: { "Content-Length": String(MAX_FEEDBACK_BODY_BYTES + 1) }, body: "data" });
    await expect(readFeedbackForm(request)).rejects.toMatchObject({ status: 413 });
    expect(request.bodyUsed).toBe(false);
  });

  it("bounds chunked requests even without Content-Length", async () => {
    let first = true;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (first) {
          first = false;
          controller.enqueue(new TextEncoder().encode('--budget\r\nContent-Disposition: form-data; name="images"; filename="image.webp"\r\nContent-Type: image/webp\r\n\r\n'));
        } else controller.enqueue(new Uint8Array(1024 * 1024));
      }, cancel,
    });
    const request = new Request("https://example.test/api/feedback", { method: "POST", body: stream, headers: { "Content-Type": "multipart/form-data; boundary=budget" }, duplex: "half" } as RequestInit);
    await expect(readFeedbackForm(request)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalled();
  });

  it("times out stalled uploads and cancels the input stream", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const request = new Request("https://example.test/api/feedback", { method: "POST", body: new ReadableStream({ cancel }), headers: { "Content-Type": "multipart/form-data; boundary=budget" }, duplex: "half" } as RequestInit);
    const assertion = expect(readFeedbackForm(request)).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(45_001);
    await assertion;
    expect(cancel).toHaveBeenCalled();
  });
});
