"use client";
import { useEffect, useRef } from "react";

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: { sitekey: string; callback: (token: string) => void; "expired-callback"?: () => void; "error-callback"?: () => void },
  ) => string;
  remove: (widgetId: string) => void;
}

/** Not a global augmentation: @medpass/ui-web declares `Window.turnstile` with a narrower option type, and two declarations must agree. */
function turnstileApi(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
let scriptPromise: Promise<void> | undefined;

function loadTurnstileScript(): Promise<void> {
  if (turnstileApi()) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      // Inserted by a nonce-trusted script, so 'strict-dynamic' (middleware.ts)
      // admits it without the host having to be on the allowlist.
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = undefined;
        reject(new Error("Failed to load Turnstile"));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

/**
 * The provider portal's own Turnstile placeholder (docs_v2/06 P11-2): a
 * separate widget from patient-web's, keyed by NEXT_PUBLIC_TURNSTILE_SITE_KEY.
 * Renders nothing when the key is unset (local, e2e) — `onToken` never fires
 * and the API skips verification the same way when its secret is unset.
 * An expired token is cleared so the sign-in button disables again.
 */
export function TurnstileWidget({ siteKey, onToken }: { siteKey?: string; onToken: (token: string | undefined) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let widgetId: string | undefined;
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        const turnstile = turnstileApi();
        if (cancelled || !containerRef.current || !turnstile) return;
        widgetId = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(undefined),
          "error-callback": () => onTokenRef.current(undefined),
        });
      })
      .catch(() => onTokenRef.current(undefined));
    return () => {
      cancelled = true;
      if (widgetId) turnstileApi()?.remove(widgetId);
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={containerRef} aria-label="Verification" />;
}
