"use client";
import { useId, useState, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";
import { axisTicks } from "../lib/observations";

/**
 * The one trend chart (docs_v2/06 P4-4/P5-3, docs_v2/10 H-39): a line per
 * series, the unit on the axis, every point drawn, an optional reference
 * band drawn only when the SOURCE supplied a range, and colour-independent
 * markers (a different shape per series, a legend when there is more than
 * one). Below it, the same numbers as a table — the screen-reader path, and
 * the large-text path.
 *
 * What it never does: colour a point by its value, draw a threshold the app
 * chose, or label anything "high"/"low" (docs_v2/10 §1). The band is a
 * neutral grey — information about what the lab printed, not a verdict.
 */
export interface TrendSeriesPoint {
  id: string;
  /** Epoch ms. */
  x: number;
  y: number;
  /** Plain tooltip text: the value as entered, with its unit and date. */
  label: string;
}

export interface TrendSeries {
  key: string;
  label: string;
  points: TrendSeriesPoint[];
  marker: "circle" | "square" | "diamond";
  dashed?: boolean;
}

export interface TrendBand {
  low: number | null;
  high: number | null;
  label: string;
}

const W = 640;
const H = 320;
const PAD = { top: 20, right: 20, bottom: 44, left: 64 };

const SERIES_COLOR = ["var(--color-primary)", "var(--color-info)"] as const;
/** Series 1 brand, series 2 info; a third series would need its own marker shape too (dataviz: never cycle hues). */
function seriesColor(i: number): string {
  return SERIES_COLOR[i % SERIES_COLOR.length] ?? SERIES_COLOR[0];
}

export function TrendChart({
  series,
  unit,
  band,
  formatX,
  ariaLabel,
  tableCaption,
  tableHeaders,
  tableRows,
}: {
  series: TrendSeries[];
  /** Axis unit — shown on the y-axis title and in every tick label. */
  unit: string;
  band?: TrendBand | null;
  formatX: (x: number) => string;
  ariaLabel: string;
  tableCaption: string;
  tableHeaders: string[];
  tableRows: Array<{ id: string; cells: ReactNode[] }>;
}) {
  const { t } = useI18n();
  const captionId = useId();
  const [active, setActive] = useState<{ series: number; index: number } | null>(null);

  const all = series.flatMap((s) => s.points);
  const ys = all.map((p) => p.y);
  if (band?.low != null) ys.push(band.low);
  if (band?.high != null) ys.push(band.high);
  const xs = all.map((p) => p.x);
  const yMinRaw = ys.length ? Math.min(...ys) : 0;
  const yMaxRaw = ys.length ? Math.max(...ys) : 1;
  const yPad = (yMaxRaw - yMinRaw || Math.abs(yMaxRaw) || 1) * 0.15;
  const yMin = yMinRaw - yPad;
  const yMax = yMaxRaw + yPad;
  const xMin = xs.length ? Math.min(...xs) : 0;
  const xMax = xs.length ? Math.max(...xs) : 1;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const sx = (x: number) => PAD.left + (xMax === xMin ? plotW / 2 : ((x - xMin) / (xMax - xMin)) * plotW);
  const sy = (y: number) => PAD.top + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH;

  const ticks = [0, 1, 2, 3, 4].map((i) => yMin + ((yMax - yMin) * i) / 4);
  // Ticks name real readings, and never twice with the same words — see
  // `axisTicks`. The old [min, midpoint, max] rendered two HbA1c values a
  // month apart as "Aug 26 / Aug 26 / Sept 26".
  const xTicks = axisTicks(xs, formatX);

  const activePoint = active ? series[active.series]?.points[active.index] : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      {/* The picture is decorative for assistive tech: the table beneath carries every number. */}
      <div style={{ width: "100%", overflow: "hidden" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={ariaLabel}
          aria-describedby={captionId}
          style={{ width: "100%", height: "auto", display: "block", fontFamily: "var(--font-family)" }}
          data-testid="trend-chart"
        >
          {/* Reference band: only what the source printed; neutral, never a verdict. */}
          {band && (band.low != null || band.high != null) ? (
            <g data-testid="trend-band">
              <rect
                x={PAD.left}
                width={plotW}
                y={sy(band.high ?? yMax)}
                height={Math.max(2, sy(band.low ?? yMin) - sy(band.high ?? yMax))}
                fill="var(--color-border)"
                opacity={0.45}
              />
              <text x={PAD.left + 6} y={sy(band.high ?? yMax) + 14} fontSize="12" fill="var(--color-text-muted)">
                {band.label}
              </text>
            </g>
          ) : null}

          {/* Gridlines and y ticks, each with the unit. */}
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={sy(v)} y2={sy(v)} stroke="var(--color-border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={sy(v) + 4} fontSize="12" textAnchor="end" fill="var(--color-text-muted)">
                {formatTick(v)} {unit}
              </text>
            </g>
          ))}
          {/* x ticks */}
          {xTicks.map((x, i) => (
            <text
              key={`${x}-${i}`}
              x={sx(x)}
              y={H - PAD.bottom + 18}
              fontSize="12"
              textAnchor={xTicks.length === 1 ? "middle" : i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
              fill="var(--color-text-muted)"
            >
              {formatX(x)}
            </text>
          ))}
          <text x={PAD.left} y={H - 6} fontSize="12" fill="var(--color-text-muted)">
            {t("trend.axis_unit", { unit })}
          </text>

          {series.map((s, si) => {
            const color = seriesColor(si);
            const path = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
            return (
              <g key={s.key} data-testid={`trend-series-${s.key}`}>
                {s.points.length > 1 ? (
                  <path d={path} fill="none" stroke={color} strokeWidth={2} strokeDasharray={s.dashed ? "6 4" : undefined} strokeLinejoin="round" />
                ) : null}
                {s.points.map((p, i) => (
                  <g
                    key={p.id}
                    onMouseEnter={() => setActive({ series: si, index: i })}
                    onMouseLeave={() => setActive(null)}
                    onClick={() => setActive((a) => (a && a.series === si && a.index === i ? null : { series: si, index: i }))}
                    style={{ cursor: "pointer" }}
                    data-testid="trend-point"
                  >
                    {/* A bigger invisible hit target than the mark itself. */}
                    <circle cx={sx(p.x)} cy={sy(p.y)} r={14} fill="transparent" />
                    <Marker shape={s.marker} cx={sx(p.x)} cy={sy(p.y)} color={color} />
                    <title>{p.label}</title>
                  </g>
                ))}
              </g>
            );
          })}

          {activePoint ? (
            <g>
              <rect
                x={Math.min(Math.max(sx(activePoint.x) - 90, PAD.left), W - PAD.right - 180)}
                y={Math.max(4, sy(activePoint.y) - 40)}
                width={180}
                height={26}
                rx={4}
                fill="var(--color-surface)"
                stroke="var(--color-border)"
              />
              <text
                x={Math.min(Math.max(sx(activePoint.x) - 90, PAD.left), W - PAD.right - 180) + 90}
                y={Math.max(4, sy(activePoint.y) - 40) + 17}
                fontSize="13"
                textAnchor="middle"
                fill="var(--color-text)"
              >
                {activePoint.label}
              </text>
            </g>
          ) : null}
        </svg>
      </div>

      {series.length > 1 ? (
        <ul aria-label={t("trend.legend")} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "var(--space-md)" }}>
          {series.map((s, si) => (
            <li key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-xs)" }}>
              <svg width="18" height="18" viewBox="-9 -9 18 18" aria-hidden="true">
                <Marker shape={s.marker} cx={0} cy={0} color={seriesColor(si)} />
              </svg>
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* The table alternative: every number the chart shows, for screen readers and for anyone who prefers a list. */}
      <div style={{ overflowX: "auto" }}>
        <table data-testid="trend-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--font-body)" }}>
          <caption id={captionId} style={{ textAlign: "start", fontWeight: 600, marginBottom: "var(--space-xs)" }}>
            {tableCaption}
          </caption>
          <thead>
            <tr>
              {tableHeaders.map((h) => (
                <th key={h} scope="col" style={{ textAlign: "start", padding: "var(--space-xs) var(--space-sm)", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr key={row.id}>
                {row.cells.map((cell, i) => (
                  <td key={i} style={{ padding: "var(--space-xs) var(--space-sm)", borderBottom: "1px solid var(--color-border)", verticalAlign: "top" }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** ≥8px marks with a 2px surface ring so overlapping points stay distinct; shape carries identity, not colour alone. */
function Marker({ shape, cx, cy, color }: { shape: TrendSeries["marker"]; cx: number; cy: number; color: string }) {
  const ring = { stroke: "var(--color-surface)", strokeWidth: 2 };
  if (shape === "square") return <rect x={cx - 5} y={cy - 5} width={10} height={10} fill={color} {...ring} />;
  if (shape === "diamond") return <path d={`M${cx},${cy - 7} L${cx + 7},${cy} L${cx},${cy + 7} L${cx - 7},${cy} Z`} fill={color} {...ring} />;
  return <circle cx={cx} cy={cy} r={5.5} fill={color} {...ring} />;
}

function formatTick(v: number): string {
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return Number(v.toFixed(digits)).toString();
}
