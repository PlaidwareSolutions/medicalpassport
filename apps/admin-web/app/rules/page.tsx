"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Table, type TableColumn } from "@medpass/ui-web";
import { AdminShell } from "../../components/AdminShell";
import { api } from "../../lib/api";

interface RuleRow {
  name: string;
  key: string;
  version: string;
}

/** Read-only rule versions (docs/06 "review") — editing stays blocked on
 * OD-6 (no clinical lead appointed to be the maker-checker's checker). */
export default function RulesPage() {
  const [rows, setRows] = useState<RuleRow[]>([]);

  useEffect(() => {
    api.get<{ items: RuleRow[] }>("/admin/rules").then((res) => setRows(res.items));
  }, []);

  const columns: TableColumn<RuleRow>[] = [
    { key: "name", header: "Rule", render: (r) => r.name },
    { key: "key", header: "Rule key", render: (r) => r.key },
    { key: "version", header: "Version", render: (r) => r.version },
  ];

  return (
    <AdminShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: "var(--font-title)" }}>Rules</h1>
        <Link href="/rules/findings"><Button variant="secondary">Browse findings</Button></Link>
      </div>
      <p style={{ color: "var(--color-text-muted)" }}>
        Rule versions are code constants, read-only here — editing requires an appointed clinical lead (OD-6) to act as the maker-checker&apos;s
        checker, which doesn&apos;t exist yet.
      </p>
      <Table columns={columns} rows={rows} rowKey={(r) => r.key} emptyLabel="Loading…" />
    </AdminShell>
  );
}
