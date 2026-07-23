"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@medpass/ui-web";
import { AdminShell } from "../components/AdminShell";
import { api } from "../lib/api";

interface SummaryCounts {
  pendingCatalogChanges?: number;
  dlqOutstanding?: number;
  recentAuditCount?: number;
}

/** Admin dashboard home (docs/06, docs/12 §8.3) — summary of the 5 working
 * feature areas; Translations stays a disabled nav item (no content data
 * model exists yet, and OD-6 blocks approving real clinical content anyway). */
export default function AdminHome() {
  const [counts, setCounts] = useState<SummaryCounts>({});

  useEffect(() => {
    api
      .get<{ items: unknown[] }>("/admin/catalog-changes?status=pending")
      .then((res) => setCounts((c) => ({ ...c, pendingCatalogChanges: res.items.length })))
      .catch(() => undefined);
    api
      .get<{ items: unknown[] }>("/admin/incidents/dlq?replayed=false")
      .then((res) => setCounts((c) => ({ ...c, dlqOutstanding: res.items.length })))
      .catch(() => undefined);
    api
      .get<{ items: unknown[] }>("/admin/audit?limit=5")
      .then((res) => setCounts((c) => ({ ...c, recentAuditCount: res.items.length })))
      .catch(() => undefined);
  }, []);

  const areas: Array<{ href: string; title: string; desc: string; count?: number; countLabel?: string }> = [
    { href: "/catalog", title: "Medication catalog", desc: "Brands, ingredients, combinations — maker-checker approval", count: counts.pendingCatalogChanges, countLabel: "pending change(s)" },
    { href: "/audit", title: "Audit search", desc: "Search the append-only audit log — itself audited on every use", count: counts.recentAuditCount, countLabel: "recent event(s)" },
    { href: "/incidents", title: "Incidents", desc: "Dead-letter job replay, admin share revocation", count: counts.dlqOutstanding, countLabel: "job(s) awaiting replay" },
    { href: "/operations", title: "Operations", desc: "Live job/DLQ/reminder/backup summary" },
    { href: "/rules", title: "Rules & findings", desc: "Rule versions (read-only) and cross-profile safety findings" },
  ];

  return (
    <AdminShell>
      <h1 style={{ fontSize: "var(--font-title)", margin: "0 0 var(--space-md)" }}>Dashboard</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {areas.map((area) => (
          <Link key={area.href} href={area.href} style={{ textDecoration: "none" }}>
            <Card>
              <strong>{area.title}</strong>
              <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{area.desc}</span>
              {area.count !== undefined ? (
                <span style={{ fontSize: "var(--font-small)", fontWeight: 600 }}>
                  {area.count} {area.countLabel}
                </span>
              ) : null}
            </Card>
          </Link>
        ))}
      </div>
    </AdminShell>
  );
}
