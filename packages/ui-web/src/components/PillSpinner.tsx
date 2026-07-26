"use client";

const SIZE_PX = { sm: 20, md: 32, lg: 48 } as const;

/**
 * Loading indicator shaped like the app's own two-tone capsule (matches
 * public/icons/icon.svg), spinning to signal "in progress" — replaces a
 * static "Loading…" paragraph that gave no visual cue the page was still
 * working versus already done. Animation respects prefers-reduced-motion
 * itself (rather than relying on a consuming app's own global CSS), since
 * this component is shared across apps.
 *
 * `tone="onDark"` swaps the two-tone fill for translucent/solid white —
 * for use on a solid-color background (e.g. inside a primary/danger
 * Button) where the default brand-green fill would clash or lose contrast.
 */
export function PillSpinner({
  size = "md",
  label,
  tone = "brand",
}: {
  size?: "sm" | "md" | "lg";
  label?: string;
  tone?: "brand" | "onDark";
}) {
  const px = SIZE_PX[size];
  const colors =
    tone === "onDark"
      ? { soft: "rgba(255,255,255,0.55)", main: "#ffffff" }
      : { soft: "var(--color-primary-soft)", main: "var(--color-primary)" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-sm)" }} role="status" aria-live="polite">
      <style>{`
        @keyframes pill-spinner-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .pill-spinner-icon { animation: pill-spinner-rotate 900ms linear infinite; transform-origin: 50% 50%; }
        @media (prefers-reduced-motion: reduce) { .pill-spinner-icon { animation: none; } }
      `}</style>
      <svg className="pill-spinner-icon" width={px} height={px} viewBox="0 0 100 100" aria-hidden="true">
        <g transform="rotate(45 50 50)">
          <rect x="30" y="15" width="40" height="70" rx="20" fill={colors.soft} />
          <rect x="30" y="15" width="40" height="35" rx="20" fill={colors.main} />
          <rect x="30" y="35" width="40" height="15" fill={colors.main} />
        </g>
      </svg>
      {label ? <span style={{ color: tone === "onDark" ? "inherit" : "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{label}</span> : null}
    </span>
  );
}
