"use client";

import { useEffect, useState, type ReactNode } from "react";

export const HERO_CTA_SENTINEL_ID = "hero-cta-sentinel";

/**
 * Minimal client wrapper that reveals the sticky-header CTA only after the
 * hero's own CTA scrolls out of view (approved wireframe rule); pages without a
 * hero sentinel show it always. Deliberately carries NO i18n — the CTA is
 * rendered on the server (build-time `t()`) and passed in as `children`, so the
 * multilingual dictionaries never enter the client bundle (§44).
 */
export function HeaderStickyCta({ children }: { children: ReactNode }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const sentinel = document.getElementById(HERO_CTA_SENTINEL_ID);
    if (!sentinel) {
      setShow(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => {
      if (entry) setShow(!entry.isIntersecting);
    });
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  return show ? <>{children}</> : null;
}
