// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { CloudflareTurnstileVerifier } from "../../worker/providers/turnstile";

describe("Turnstile production configuration", () => {
  it("fails closed before making a request when no expected hostname is configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const verifier = new CloudflareTurnstileVerifier("secret", new Set(), false);

    await expect(
      verifier.verify({ token: "token", remoteIp: null, expectedAction: "request_otp" }),
    ).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
