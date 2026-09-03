import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Studio route isolation", () => {
  it("opens the protected Studio branch without loading public config or navigation", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
      if (path === "/api/studio/session") {
        return new Response(JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED", message: "请先登录 Studio" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/studio");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "登录 Studio" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/config"))).toBe(false);
    expect(screen.queryByRole("link", { name: "提交留言" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "我的留言" })).not.toBeInTheDocument();
  });
});
