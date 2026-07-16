/**
 * Design tokens (docs/33): contrast-validated palette, spacing/size scales
 * encoding the 48dp touch-target minimum. Shared by web now and native later.
 */
export const tokens = {
  color: {
    // 4.5:1+ contrast pairs on white; verified for WCAG AA.
    primary: "#0f6b54", // deep green — trust/health, AA on white
    primaryContrast: "#ffffff",
    primarySoft: "#e3f2ed",
    text: "#1a1d1f",
    textMuted: "#4c5563",
    background: "#ffffff",
    surface: "#f6f8f7",
    border: "#d4dbd8",
    danger: "#b3261e",
    dangerSoft: "#fdebe9",
    warning: "#8a5300",
    warningSoft: "#fff4e0",
    info: "#0b57a4",
    infoSoft: "#e7f0fa",
    success: "#1b6e2f",
    successSoft: "#e8f5ec",
  },
  font: {
    /** 16px minimum body size (docs/33). */
    sizeBody: "1rem",
    sizeSmall: "0.875rem",
    sizeLarge: "1.25rem",
    sizeTitle: "1.5rem",
    family:
      "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Telugu', 'Noto Nastaliq Urdu', sans-serif",
  },
  size: {
    /** Minimum touch target (48dp). */
    touchTarget: "48px",
    touchGap: "8px",
    radius: "12px",
    radiusSmall: "8px",
    bottomNavHeight: "64px",
  },
  space: {
    xs: "4px",
    sm: "8px",
    md: "16px",
    lg: "24px",
    xl: "32px",
  },
} as const;

/** Renders the tokens as CSS custom properties for a :root block. */
export function cssVariables(): string {
  const c = tokens.color;
  const f = tokens.font;
  const s = tokens.size;
  const sp = tokens.space;
  return `:root{--color-primary:${c.primary};--color-primary-contrast:${c.primaryContrast};--color-primary-soft:${c.primarySoft};--color-text:${c.text};--color-text-muted:${c.textMuted};--color-bg:${c.background};--color-surface:${c.surface};--color-border:${c.border};--color-danger:${c.danger};--color-danger-soft:${c.dangerSoft};--color-warning:${c.warning};--color-warning-soft:${c.warningSoft};--color-info:${c.info};--color-info-soft:${c.infoSoft};--color-success:${c.success};--color-success-soft:${c.successSoft};--font-body:${f.sizeBody};--font-small:${f.sizeSmall};--font-large:${f.sizeLarge};--font-title:${f.sizeTitle};--font-family:${f.family};--size-touch:${s.touchTarget};--size-touch-gap:${s.touchGap};--radius:${s.radius};--radius-sm:${s.radiusSmall};--bottom-nav-height:${s.bottomNavHeight};--space-xs:${sp.xs};--space-sm:${sp.sm};--space-md:${sp.md};--space-lg:${sp.lg};--space-xl:${sp.xl};}`;
}
