"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The brand film (owner-supplied commercial, with soundtrack).
 *
 * Owner-directed behavior (2026-08-31, overriding the site's earlier
 * never-autoplay-audio rule for this one asset): the film starts by itself
 * when the section scrolls into view, WITH volume where the browser allows
 * it. Browsers refuse unmuted playback before any user gesture on the page,
 * so this is a ladder, never a lie:
 *
 *   1. ≥55% in view → try UNMUTED play (succeeds if the visitor has
 *      clicked/tapped anything on the page before scrolling here).
 *   2. Refused → play MUTED (always allowed) with a prominent
 *      "tap for sound" button; one tap unmutes.
 *   3. prefers-reduced-motion or Save-Data → no autoplay at all: the
 *      original poster + play button (user-initiated, with sound).
 *
 * Scrolling away pauses; scrolling back resumes — unless the visitor
 * paused it themselves via the native controls, which is respected.
 */
export function CommercialFilm({
  sources,
  poster,
  label,
  playLabel,
  unmuteLabel,
}: {
  sources: { src: string; type: string }[];
  poster: string;
  label: string;
  playLabel: string;
  unmuteLabel: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** null = capability unknown (SSR/first paint) — renders the poster branch. */
  const [autoplayAllowed, setAutoplayAllowed] = useState<boolean | null>(null);
  const [manuallyStarted, setManuallyStarted] = useState(false);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const userPausedRef = useRef(false);
  const startedRef = useRef(false);

  useEffect(() => {
    const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setAutoplayAllowed(!(conn?.saveData || reduced));
  }, []);

  const active = autoplayAllowed === true || manuallyStarted;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !autoplayAllowed || manuallyStarted) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          if (userPausedRef.current) return;
          if (!startedRef.current) {
            startedRef.current = true;
            video.muted = false;
            void video.play().catch(() => {
              // No prior gesture on the page: unmuted refused. Muted is
              // always allowed — play silently and surface the unmute tap.
              video.muted = true;
              setNeedsUnmute(true);
              void video.play().catch(() => {
                // Even muted refused (rare): fall back to click-to-play.
                startedRef.current = false;
                setAutoplayAllowed(false);
              });
            });
          } else if (video.paused && !video.ended) {
            void video.play().catch(() => undefined);
          }
        } else if (startedRef.current && !video.paused) {
          video.pause();
          // An out-of-view pause is ours, not the visitor's.
          userPausedRef.current = false;
        }
      },
      { threshold: 0.55 },
    );
    io.observe(video);

    const onPause = () => {
      // Native-controls pause while still in view = the visitor's choice.
      if (!video.ended && startedRef.current && isInView(video)) userPausedRef.current = true;
    };
    const onPlay = () => {
      userPausedRef.current = false;
    };
    video.addEventListener("pause", onPause);
    video.addEventListener("play", onPlay);
    return () => {
      io.disconnect();
      video.removeEventListener("pause", onPause);
      video.removeEventListener("play", onPlay);
    };
  }, [autoplayAllowed, manuallyStarted]);

  const frame: React.CSSProperties = {
    position: "relative",
    aspectRatio: "9 / 16",
    width: "100%",
    maxWidth: "330px",
    marginInline: "auto",
    borderRadius: "var(--mkt-radius-frame)",
    overflow: "hidden",
    background: "var(--mkt-soft)",
    boxShadow: "0 12px 32px rgba(26,31,29,.10)",
  };
  const inner: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  };

  return (
    <div style={frame}>
      {active ? (
        <>
          <video
            ref={videoRef}
            style={inner}
            controls
            playsInline
            preload="metadata"
            poster={poster}
            aria-label={label}
            autoPlay={manuallyStarted}
          >
            {sources.map((s) => (
              <source key={s.src} src={s.src} type={s.type} />
            ))}
          </video>
          {needsUnmute ? (
            <button
              type="button"
              onClick={() => {
                const video = videoRef.current;
                if (video) {
                  video.muted = false;
                  void video.play().catch(() => undefined);
                }
                setNeedsUnmute(false);
              }}
              style={{
                position: "absolute",
                top: "12px",
                insetInlineStart: "12px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 14px",
                borderRadius: "999px",
                border: "none",
                cursor: "pointer",
                background: "rgba(26,31,29,.78)",
                color: "#fff",
                fontWeight: 600,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 100 100" aria-hidden="true">
                <path d="M14 38h14l24-20v64L28 62H14z" fill="currentColor" />
                <path d="M66 38a17 17 0 010 24M78 27a34 34 0 010 46" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
              </svg>
              {unmuteLabel}
            </button>
          ) : null}
        </>
      ) : (
        <>
          <img style={inner} src={poster} alt={label} loading="lazy" />
          <button
            type="button"
            onClick={() => setManuallyStarted(true)}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              background: "rgba(26,31,29,.28)",
              border: "none",
              cursor: "pointer",
              color: "#fff",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "50%",
                background: "rgba(255,255,255,.92)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="26" height="26" viewBox="0 0 100 100" aria-hidden="true">
                <path d="M30 18l48 32-48 32z" fill="var(--mkt-ink, #1a1f1d)" />
              </svg>
            </span>
            <span style={{ fontWeight: 600, textShadow: "0 1px 4px rgba(0,0,0,.5)" }}>{playLabel}</span>
          </button>
        </>
      )}
    </div>
  );
}

function isInView(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
  return visible > r.height * 0.55;
}
