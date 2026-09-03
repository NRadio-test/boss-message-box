import type { TurnstileVerifier } from "../core/ports";

interface SiteverifyResponse {
  success: boolean;
  action?: string;
  hostname?: string;
}

export class CloudflareTurnstileVerifier implements TurnstileVerifier {
  constructor(
    private readonly secretKey: string,
    private readonly expectedHostnames: Set<string>,
    private readonly isDevelopment: boolean,
  ) {}

  async verify(input: {
    token: string;
    remoteIp: string | null;
    expectedAction: string;
  }): Promise<boolean> {
    if (!this.isDevelopment && this.expectedHostnames.size === 0) return false;
    const idempotencyKey = crypto.randomUUID();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        const formData = new FormData();
        formData.set("secret", this.secretKey);
        formData.set("response", input.token);
        formData.set("idempotency_key", idempotencyKey);
        if (input.remoteIp) formData.set("remoteip", input.remoteIp);
        const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
        if (!response.ok) {
          if (attempt === 0 && response.status >= 500) continue;
          return false;
        }
        const result = (await response.json()) as SiteverifyResponse;
        if (!result.success) return false;
        if (!this.isDevelopment && result.action !== input.expectedAction) return false;
        if (
          !this.isDevelopment &&
          this.expectedHostnames.size > 0 &&
          (!result.hostname || !this.expectedHostnames.has(result.hostname))
        ) {
          return false;
        }
        return true;
      } catch {
        if (attempt === 1) return false;
      } finally {
        clearTimeout(timeout);
      }
    }
    return false;
  }
}
