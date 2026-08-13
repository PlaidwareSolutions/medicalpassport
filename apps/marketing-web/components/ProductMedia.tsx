"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Foundation of the media-fallback ladder (docs/landing-page/05 §7):
 * video → poster → placeholder. Autoplay is muted+playsinline+loop only,
 * plays only while in the viewport, and is skipped entirely under Save-Data
 * or prefers-reduced-motion (poster shown instead). Real assets arrive with
 * the media phase (Sessions 8–9); with no sources the reserved-aspect
 * placeholder renders so layout never shifts.
 */
export function ProductMedia({
  sources,
  poster,
  label,
  eager,
}: {
  sources?: { src: string; type: string }[];
  poster?: string;
  label: string;
  /** Hero only: the poster is an LCP candidate and must not lazy-load. */
  eager?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [allowVideo, setAllowVideo] = useState(false);

  useEffect(() => {
    if (!sources?.length) return;
    const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (conn?.saveData || reduced) return;
    setAllowVideo(true);
  }, [sources]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !allowVideo) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) void video.play().catch(() => undefined);
        else video.pause();
      },
      { threshold: 0.25 },
    );
    io.observe(video);
    return () => io.disconnect();
  }, [allowVideo]);

  // The OUTER frame reserves the box via aspect-ratio; the inner media is
  // absolutely positioned to fill it. This means swapping <img> ⇄ <video> after
  // hydration (poster → autoplay) never changes the container height, so it
  // cannot cause a layout shift (CLS) — the reserved space is held throughout.
  const frame: React.CSSProperties = {
    position: "relative",
    aspectRatio: "390 / 780",
    width: "100%",
    borderRadius: "calc(var(--mkt-radius-frame) - 8px)",
    overflow: "hidden",
    background: "var(--mkt-soft)",
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
      {allowVideo && sources?.length ? (
        <video ref={videoRef} style={inner} muted playsInline loop preload="none" poster={poster} aria-label={label}>
          {sources.map((s) => (
            <source key={s.src} src={s.src} type={s.type} />
          ))}
        </video>
      ) : poster ? (
        <img style={inner} src={poster} alt={label} loading={eager ? "eager" : "lazy"} />
      ) : (
        <div style={{ ...inner, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p className="mkt-muted" style={{ fontSize: "0.875rem", padding: "16px", textAlign: "center" }}>
            {label}
          </p>
        </div>
      )}
    </div>
  );
}

/** Generic matte device frame — deliberately quieter than the app UI inside. */
export function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1.5px solid rgba(26,31,29,.16)",
        borderRadius: "var(--mkt-radius-frame)",
        background: "var(--mkt-surface)",
        padding: "8px",
        boxShadow: "0 12px 32px rgba(26,31,29,.10)",
        maxWidth: "290px",
        marginInline: "auto",
      }}
    >
      {children}
    </div>
  );
}
