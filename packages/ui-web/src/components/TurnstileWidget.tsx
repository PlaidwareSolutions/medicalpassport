"use client";
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: { sitekey: string; callback: (token: string) => void; "expired-callback"?: () => void },
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
let scriptPromise: Promise<void> | undefined;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Turnstile"));
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

/**
 * Cloudflare Turnstile (docs/26 §12.4) — bot-detection on OTP request.
 * "Managed" mode (how the widget was provisioned) lets Cloudflare itself
 * decide whether a visitor needs a visible challenge or passes invisibly,
 * which is docs/26's "challenged when suspicious" with no custom
 * suspicion-scoring needed here. Renders nothing when no site key is
 * configured (dev/local, where Turnstile isn't provisioned) — `onToken`
 * simply never fires, and the server skips verification the same way when
 * its own secret isn't set.
 */
export function TurnstileWidget({ siteKey, onToken }: { siteKey?: string; onToken: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let widgetId: string | undefined;
    let cancelled = false;
    loadTurnstileScript().then(() => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      widgetId = window.turnstile.render(containerRef.current, { sitekey: siteKey, callback: onToken });
    });
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={containerRef} />;
}
