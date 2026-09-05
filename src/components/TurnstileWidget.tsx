import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: "dark";
      appearance: "interaction-only";
      execution: "execute";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export interface TurnstileHandle {
  getToken(): Promise<string>;
  reset(): void;
}

export const TurnstileWidget = forwardRef<TurnstileHandle, { siteKey: string; action?: string }>(
  function TurnstileWidget({ siteKey, action = "feedback_submit" }, forwardedRef) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetId = useRef<string | null>(null);
    const token = useRef<string | null>(null);
    const resolver = useRef<{
      promise: Promise<string>;
      resolve: (token: string) => void;
      reject: (error: Error) => void;
    } | null>(null);
    const [ready, setReady] = useState(Boolean(window.turnstile));
    const [loadError, setLoadError] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
      if (window.turnstile) {
        setReady(true);
        return;
      }
      let existing = document.querySelector<HTMLScriptElement>("script[data-turnstile-script]");
      if (existing?.dataset.failed === "true") {
        existing.remove();
        existing = null;
      }
      const script = existing ?? document.createElement("script");
      const onLoad = () => {
        clearTimeout(timeout);
        if (window.turnstile) { setReady(true); setLoadError(false); }
        else onError();
      };
      const onError = () => {
        clearTimeout(timeout);
        script.dataset.failed = "true";
        setLoadError(true);
      };
      const timeout = setTimeout(onError, 15_000);
      script.addEventListener("load", onLoad);
      script.addEventListener("error", onError);
      if (!existing) {
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.dataset.turnstileScript = "true";
        document.head.append(script);
      }
      return () => {
        clearTimeout(timeout);
        script.removeEventListener("load", onLoad);
        script.removeEventListener("error", onError);
      };
    }, [attempt]);

    useEffect(() => {
      if (!ready || !window.turnstile || !containerRef.current || widgetId.current) return;
      try {
        widgetId.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        theme: "dark",
        appearance: "interaction-only",
        execution: "execute",
        callback: (nextToken) => {
          token.current = nextToken;
          resolver.current?.resolve(nextToken);
        },
        "expired-callback": () => {
          token.current = null;
          resolver.current?.reject(new Error("安全验证已过期，请重试"));
        },
        "error-callback": () => {
          resolver.current?.reject(new Error("安全验证加载失败，请检查网络后重试"));
          token.current = null;
          setLoadError(true);
        },
        });
      } catch {
        setLoadError(true);
      }
      return () => {
        resolver.current?.reject(new Error("安全验证已取消"));
        token.current = null;
        if (widgetId.current && window.turnstile) {
          try { window.turnstile.remove(widgetId.current); } catch { /* Already removed. */ }
        }
        widgetId.current = null;
      };
    }, [action, ready, siteKey, attempt]);

    useImperativeHandle(forwardedRef, () => ({
      getToken: () => {
        if (token.current) return Promise.resolve(token.current);
        if (resolver.current) return resolver.current.promise;
        if (loadError) return Promise.reject(new Error("安全验证加载失败，请检查网络后重试"));
        if (!window.turnstile || !widgetId.current) {
          return Promise.reject(new Error("安全验证仍在加载，请稍后再试"));
        }
        let resolveToken!: (value: string) => void;
        let rejectToken!: (error: Error) => void;
        const promise = new Promise<string>((resolve, reject) => {
          resolveToken = resolve;
          rejectToken = reject;
        });
        const finish = () => { clearTimeout(timeout); resolver.current = null; };
        const timeout = setTimeout(() => {
          resolver.current?.reject(new Error("安全验证超时，请检查网络后重试"));
          token.current = null;
          setLoadError(true);
        }, 30_000);
        resolver.current = {
          promise,
          resolve: (value) => { finish(); resolveToken(value); },
          reject: (error) => { finish(); rejectToken(error); },
        };
        try { window.turnstile.execute(widgetId.current); } catch {
          resolver.current?.reject(new Error("安全验证加载失败，请检查网络后重试"));
          setLoadError(true);
        }
        return promise;
      },
      reset: () => {
        token.current = null;
        resolver.current?.reject(new Error("安全验证已取消"));
        if (window.turnstile && widgetId.current) {
          try { window.turnstile.reset(widgetId.current); } catch { setLoadError(true); }
        }
      },
    }));

    return (
      <div className="turnstile-wrap" aria-live="polite">
        <div ref={containerRef} />
        <span>{loadError ? "安全验证加载失败" : "提交时会自动进行安全验证"}</span>
        {loadError && <button type="button" className="button button--quiet" onClick={() => {
          setLoadError(false);
          setReady(false);
          setAttempt((current) => current + 1);
        }}>重新加载验证</button>}
      </div>
    );
  },
);
