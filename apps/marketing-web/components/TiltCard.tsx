"use client";

import { useRef, type ReactNode } from "react";

/**
 * Subtle pointer-follow tilt for the S3 passport card — the record "responds"
 * when explored. Fine pointers only (touch scrolling must never fight a
 * transform), max ±5°, springs flat on leave, inert under reduced motion.
 */
export function TiltCard({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(800px) rotateY(${px * 8}deg) rotateX(${py * -8}deg)`;
  }

  function onLeave() {
    if (ref.current) ref.current.style.transform = "";
  }

  return (
    <div ref={ref} className="mkt-tilt" onPointerMove={onMove} onPointerLeave={onLeave}>
      {children}
    </div>
  );
}
