import { createRef } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TurnstileWidget, type TurnstileHandle } from "../../src/components/TurnstileWidget";

beforeEach(() => {
  window.turnstile = { render: vi.fn(() => "test-widget"), execute: vi.fn(), remove: vi.fn(), reset: vi.fn() };
});
afterEach(() => { delete window.turnstile; vi.useRealTimers(); });

it("rejects an unfinished token request on unmount", async () => {
  const ref = createRef<TurnstileHandle>();
  const view = render(<TurnstileWidget ref={ref} siteKey="test" />);
  const assertion = expect(ref.current!.getToken()).rejects.toThrow("安全验证已取消");
  view.unmount();
  await assertion;
});

it("times out silent verification and offers a retry", async () => {
  vi.useFakeTimers();
  const ref = createRef<TurnstileHandle>();
  render(<TurnstileWidget ref={ref} siteKey="test" />);
  const assertion = expect(ref.current!.getToken()).rejects.toThrow("安全验证超时");
  await act(async () => { await vi.advanceTimersByTimeAsync(30_001); });
  await assertion;
  expect(screen.getByRole("button", { name: "重新加载验证" })).toBeInTheDocument();
});
