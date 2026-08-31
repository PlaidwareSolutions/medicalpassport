"use client";
import { useEffect, useState } from "react";
import { ApiError } from "@medpass/api-client";
import { Banner, Card, Chip, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AdminShell } from "../../components/AdminShell";
import { api } from "../../lib/api";

interface UserRow {
  userId: string;
  displayName: string | null;
  phoneMasked: string;
  yearOfBirth: number | null;
  status: string;
  signedUpAt: string;
  lastActiveAt: string | null;
  usageDays: number;
  medications: number;
  prescriptions: number;
  reports: number;
  glucoseReadings: number;
  bpReadings: number;
  weightReadings: number;
  caregivers: number;
  dependents: number;
}

interface Overview {
  totals: { users: number; newLast7d: number; activeLast7d: number; singleDayUsers: number };
  onboardingByWeek: { weekStart: string; count: number }[];
  items: UserRow[];
}

const TEAL = "#0F847E";

/** Weekly onboarding bars: thin marks, rounded data ends, direct labels. */
function OnboardingChart({ weeks }: { weeks: Overview["onboardingByWeek"] }) {
  const W = 720;
  const H = 200;
  const M = { top: 24, right: 8, bottom: 30, left: 26 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const max = Math.max(5, ...weeks.map((w) => w.count));
  const step = iw / Math.max(weeks.length, 1);
  const bw = Math.min(44, step * 0.7);
  const label = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Users onboarded per week; values in the table below" style={{ width: "100%", minWidth: 480 }}>
        {[0, Math.ceil(max / 2), max].map((y) => {
          const gy = M.top + ih - (y / max) * ih;
          return (
            <g key={y}>
              <line x1={M.left} x2={W - M.right} y1={gy} y2={gy} stroke="var(--color-border)" strokeWidth={y === 0 ? 1.5 : 1} />
              {y > 0 ? (
                <text x={M.left - 6} y={gy + 4} textAnchor="end" fontSize={10} fill="var(--color-text-muted)">
                  {y}
                </text>
              ) : null}
            </g>
          );
        })}
        {weeks.map((w, i) => {
          const cx = M.left + step * i + step / 2;
          const h = w.count > 0 ? Math.max((w.count / max) * ih, 5) : 0;
          const y = M.top + ih - h;
          const r = Math.min(4, h / 2);
          return (
            <g key={w.weekStart}>
              {w.count > 0 ? (
                <>
                  <path
                    d={`M${cx - bw / 2} ${M.top + ih} V${y + r} a${r} ${r} 0 0 1 ${r} -${r} H${cx + bw / 2 - r} a${r} ${r} 0 0 1 ${r} ${r} V${M.top + ih} Z`}
                    fill={TEAL}
                  />
                  <text x={cx} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--color-text)">
                    {w.count}
                  </text>
                </>
              ) : (
                <line x1={cx - bw / 2} x2={cx + bw / 2} y1={M.top + ih} y2={M.top + ih} stroke="var(--color-border)" strokeWidth={3} strokeLinecap="round" />
              )}
              <text x={cx} y={M.top + ih + 16} textAnchor="middle" fontSize={9.5} fill="var(--color-text-muted)">
                {label(w.weekStart)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <Card style={{ flex: 1, minWidth: 120 }}>
      <strong style={{ fontSize: "var(--font-large)" }}>{value}</strong>
      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{label}</span>
    </Card>
  );
}

/**
 * User info + onboarding analysis (users_view duty). Identity + engagement
 * only — the API never returns clinical content, and the phone arrives
 * pre-masked. Every load of this page is written to the audit chain.
 */
export default function AdminUsersPage() {
  const [data, setData] = useState<Overview | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    api
      .get<Overview>("/admin/users/overview")
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.problem.title : "Something went wrong"));
  }, []);

  const day = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";

  return (
    <AdminShell>
      <SectionTitle>Users</SectionTitle>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {!data && !error ? <PillSpinner label="Loading…" /> : null}

      {data ? (
        <>
          <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
            <Stat value={data.totals.users} label="Users" />
            <Stat value={data.totals.newLast7d} label="New, last 7 days" />
            <Stat value={data.totals.activeLast7d} label="Active, last 7 days" />
            <Stat value={data.totals.singleDayUsers} label="Used one day only" />
          </div>

          <SectionTitle>Onboarded by week</SectionTitle>
          <Card>
            <OnboardingChart weeks={data.onboardingByWeek} />
          </Card>

          <SectionTitle>All users</SectionTitle>
          <Card style={{ padding: 0, overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontVariantNumeric: "tabular-nums", fontSize: "var(--font-small)" }}>
              <thead>
                <tr>
                  {["Name", "Phone", "Born", "Signed up", "Last active", "Days", "Meds", "Rx", "Reports", "Glucose", "BP", "Weight", "Caregivers", "Dependents"].map((h) => (
                    <th key={h} style={{ textAlign: "start", padding: "10px 12px", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.userId}>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                      {u.displayName ?? <span style={{ color: "var(--color-text-muted)" }}>No profile yet</span>}
                      {u.status !== "active" ? (
                        <>
                          {" "}
                          <Chip tone="warning">{u.status}</Chip>
                        </>
                      ) : null}
                    </td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{u.phoneMasked}</td>
                    <td style={{ padding: "8px 12px" }}>{u.yearOfBirth ?? "—"}</td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{day(u.signedUpAt)}</td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{day(u.lastActiveAt)}</td>
                    <td style={{ padding: "8px 12px" }}>{u.usageDays}</td>
                    <td style={{ padding: "8px 12px" }}>{u.medications}</td>
                    <td style={{ padding: "8px 12px" }}>{u.prescriptions}</td>
                    <td style={{ padding: "8px 12px" }}>{u.reports}</td>
                    <td style={{ padding: "8px 12px" }}>{u.glucoseReadings}</td>
                    <td style={{ padding: "8px 12px" }}>{u.bpReadings}</td>
                    <td style={{ padding: "8px 12px" }}>{u.weightReadings}</td>
                    <td style={{ padding: "8px 12px" }}>{u.caregivers}</td>
                    <td style={{ padding: "8px 12px" }}>{u.dependents}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)", maxWidth: "70ch" }}>
            Identity and engagement only — record contents (medicine names, readings, documents) are never visible to
            admin accounts. Every view of this page is audited.
          </p>
        </>
      ) : null}
    </AdminShell>
  );
}
