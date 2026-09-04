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
    const resolver = useRef<{ resolve: (token: string) => void; reject: (error: Error) => void } | null>(null);
    const [ready, setReady] = useState(Boolean(window.turnstile));
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
      if (window.turnstile) {
        setReady(true);
        return;
      }
      const existing = document.querySelector<HTMLScriptElement>("script[data-turnstile-script]");
      const script = existing ?? document.createElement("script");
      const onLoad = () => setReady(true);
      const onError = () => setLoadError(true);
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
        script.removeEventListener("load", onLoad);
        script.removeEventListener("error", onError);
      };
    }, []);

    useEffect(() => {
      if (!ready || !window.turnstile || !containerRef.current || widgetId.current) return;
      widgetId.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        theme: "dark",
        appearance: "interaction-only",
        execution: "execute",
        callback: (nextToken) => {
          token.current = nextToken;
          resolver.current?.resolve(nextToken);
          resolver.current = null;
        },
        "expired-callback": () => {
          token.current = null;
        },
        "error-callback": () => {
          resolver.current?.reject(new Error("安全验证加载失败，请检查网络后重试"));
          resolver.current = null;
        },
      });
      return () => {
        if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      };
    }, [action, ready, siteKey]);

    useImperativeHandle(forwardedRef, () => ({
      getToken: () => {
        if (token.current) return Promise.resolve(token.current);
        if (loadError) return Promise.reject(new Error("安全验证加载失败，请检查网络后重试"));
        if (!window.turnstile || !widgetId.current) {
          return Promise.reject(new Error("安全验证仍在加载，请稍后再试"));
        }
        return new Promise<string>((resolve, reject) => {
          resolver.current = { resolve, reject };
          window.turnstile!.execute(widgetId.current!);
        });
      },
      reset: () => {
        token.current = null;
        if (window.turnstile && widgetId.current) window.turnstile.reset(widgetId.current);
      },
    }));

    return (
      <div className="turnstile-wrap" aria-live="polite">
        <div ref={containerRef} />
        <span>{loadError ? "安全验证加载失败" : "提交时会自动进行安全验证"}</span>
      </div>
    );
  },
);
