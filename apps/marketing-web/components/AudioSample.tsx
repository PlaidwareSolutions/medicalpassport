"use client";

import { useRef, useState } from "react";

/**
 * The explicit user-controlled audio demonstration (Session 9B §7): the real
 * Medicine Passport guidance voice, played only on user action. Never
 * autoplays, never couples to the silent demo videos, `preload="none"` so
 * nothing downloads before interaction. Keyboard accessible (it's a real
 * button) with state reflected in the label and `aria-pressed`; on failure
 * it settles into a quiet unavailable state without retry loops — the
 * surrounding copy carries all essential information.
 */
export function AudioSample({
  src,
  playLabel,
  stopLabel,
  errorLabel,
}: {
  src: string;
  playLabel: string;
  stopLabel: string;
  errorLabel: string;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<"idle" | "playing" | "error">("idle");

  const toggle = async () => {
    const audio = ref.current;
    if (!audio || state === "error") return;
    if (state === "playing") {
      audio.pause();
      audio.currentTime = 0;
      setState("idle");
      return;
    }
    try {
      await audio.play();
      setState("playing");
    } catch {
      setState("error");
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        disabled={state === "error"}
        aria-pressed={state === "playing"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "10px",
          border: "1px solid var(--mkt-hairline)",
          background: "var(--mkt-surface)",
          color: state === "error" ? "var(--mkt-muted)" : "var(--mkt-primary)",
          borderRadius: "999px",
          padding: "12px 20px",
          minHeight: "var(--size-touch)",
          fontWeight: 650,
          fontSize: "0.9375rem",
          cursor: state === "error" ? "default" : "pointer",
        }}
      >
        <span aria-hidden="true">{state === "playing" ? "◼" : "▶"}</span>
        {state === "error" ? errorLabel : state === "playing" ? stopLabel : playLabel}
      </button>
      <audio ref={ref} src={src} preload="none" onEnded={() => setState("idle")} onError={() => setState("error")} />
    </div>
  );
}
