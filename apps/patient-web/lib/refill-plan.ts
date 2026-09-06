"use client";
export { putRefillPlan, useRefillPlan, type RefillPlanDto } from "./medications";

/** "30.000" → "30", "1.500" → "1.5" — server decimals carry a fixed scale. */
export function trimDecimalString(v: string | null | undefined): string {
  if (v == null || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : v;
}
