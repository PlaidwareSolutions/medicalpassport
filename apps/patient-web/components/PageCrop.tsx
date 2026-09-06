"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@medpass/ui-web";
import type { BoundingBox } from "../lib/documents";
import { useI18n } from "../lib/i18n";

const WINDOW_HEIGHT = 200;

/**
 * The page a candidate was read from, with that candidate's bounding box
 * outlined on top (docs_v2/09 §10 "the page crop beside each field"). The
 * box arrives normalized 0–1, so the outline is positioned in percentages
 * of the rendered image and stays right at any width or zoom. By default a
 * 200px window scrolls the outlined line into view; "Show whole page"
 * expands it. Nothing here decodes or re-encodes the image: the original
 * pixels are exactly what the patient sees (docs_v2/09 §1 rule 1).
 */
export function PageCrop({ src, box, pageNumber, contentType }: { src: string | null; box: BoundingBox | null; pageNumber: number | null; contentType?: string | null }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [ratio, setRatio] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const alt = pageNumber ? t("documents.page_alt", { n: pageNumber }) : t("documents.page_alt_unknown");

  if (!src || contentType === "application/pdf") {
    return (
      <div style={{ padding: "var(--space-sm)", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
        {src ? (
          <a href={src} target="_blank" rel="noopener noreferrer">
            {t("documents.open_pdf_page", { n: pageNumber ?? 1 })}
          </a>
        ) : (
          t("documents.page_unavailable")
        )}
      </div>
    );
  }

  const displayedHeight = ratio && width ? width * ratio : 0;
  let offset = 0;
  if (!expanded && box && displayedHeight > WINDOW_HEIGHT) {
    const centre = (box.y + box.h / 2) * displayedHeight;
    offset = Math.max(0, Math.min(displayedHeight - WINDOW_HEIGHT, centre - WINDOW_HEIGHT / 2));
  }

  return (
    <div>
      <div
        ref={frameRef}
        style={{
          position: "relative",
          overflow: "hidden",
          height: expanded || !displayedHeight ? "auto" : WINDOW_HEIGHT,
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)",
          background: "var(--color-surface)",
        }}
      >
        <div style={{ position: "relative", width: "100%", transform: `translateY(-${offset}px)` }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- presigned, short-lived URL; Next image optimisation must never proxy PHI */}
          <img
            src={src}
            alt={alt}
            style={{ display: "block", width: "100%", height: "auto" }}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth > 0) setRatio(img.naturalHeight / img.naturalWidth);
            }}
          />
          {box ? (
            <div
              data-testid="candidate-box"
              aria-hidden="true"
              style={{
                position: "absolute",
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`,
                border: "3px solid var(--color-primary)",
                borderRadius: 4,
                boxShadow: "0 0 0 2px rgba(255,255,255,0.85)",
                pointerEvents: "none",
              }}
            />
          ) : null}
        </div>
      </div>
      {displayedHeight > WINDOW_HEIGHT ? (
        <Button variant="ghost" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} style={{ marginTop: "var(--space-xs)" }}>
          {expanded ? t("documents.show_crop") : t("documents.show_whole_page")}
        </Button>
      ) : null}
    </div>
  );
}
