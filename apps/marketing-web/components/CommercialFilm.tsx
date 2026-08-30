"use client";

import { useState } from "react";

/**
 * The brand film (owner-supplied commercial). Unlike ProductMedia's silent
 * in-viewport loops, this clip HAS a soundtrack, so it is strictly
 * user-initiated (docs/landing-page media rules: audio never autoplays):
 * a poster with a real play button, and only after that click does a
 * <video controls> mount — with native controls, sound on, no loop. Nothing
 * is fetched before the click (the poster aside), which also preserves the
 * reduced-motion/Save-Data invariant of zero autoplaying video elements.
 */
export function CommercialFilm({
  sources,
  poster,
  label,
  playLabel,
}: {
  sources: { src: string; type: string }[];
  poster: string;
  label: string;
  playLabel: string;
}) {
  const [playing, setPlaying] = useState(false);

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
      {playing ? (
        <video style={inner} controls autoPlay playsInline preload="none" poster={poster} aria-label={label}>
          {sources.map((s) => (
            <source key={s.src} src={s.src} type={s.type} />
          ))}
        </video>
      ) : (
        <>
          <img style={inner} src={poster} alt={label} loading="lazy" />
          <button
            type="button"
            onClick={() => setPlaying(true)}
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
