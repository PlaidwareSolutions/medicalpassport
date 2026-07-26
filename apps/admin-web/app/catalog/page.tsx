"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, PillSpinner, SectionTitle, Table, TextInput, type TableColumn } from "@medpass/ui-web";
import { AdminShell } from "../../components/AdminShell";
import { api } from "../../lib/api";

const ENTITY_TYPES = [
  { value: "ingredient", label: "Ingredients" },
  { value: "manufacturer", label: "Manufacturers" },
  { value: "brand", label: "Brands" },
  { value: "dosage_form", label: "Dosage forms" },
  { value: "route", label: "Administration routes" },
  { value: "product", label: "Products" },
  { value: "classification", label: "Therapeutic classes" },
] as const;
type EntityType = (typeof ENTITY_TYPES)[number]["value"];
const DEPRECATABLE = new Set<EntityType>(["ingredient", "manufacturer", "brand", "product"]);

interface CatalogRow {
  id: string;
  name?: string;
  genericName?: string;
  status?: string;
}

export default function CatalogPage() {
  const [entityType, setEntityType] = useState<EntityType>("ingredient");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ items: CatalogRow[] }>(`/admin/catalog/${entityType}${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      setRows(res.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType]);

  const columns: TableColumn<CatalogRow>[] = [
    { key: "name", header: "Name", render: (r) => r.name ?? r.genericName ?? r.id },
    ...(DEPRECATABLE.has(entityType) ? [{ key: "status", header: "Status", render: (r: CatalogRow) => r.status ?? "—" }] : []),
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div style={{ display: "flex", gap: "var(--space-sm)" }}>
          <Link href={`/catalog/changes/new?entityType=${entityType}&operation=update&entityId=${r.id}`}>Edit</Link>
          {DEPRECATABLE.has(entityType) && r.status !== "deprecated" ? (
            <Link href={`/catalog/changes/new?entityType=${entityType}&operation=deprecate&entityId=${r.id}`}>Deprecate</Link>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <AdminShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: "var(--font-title)" }}>Catalog</h1>
        <div style={{ display: "flex", gap: "var(--space-sm)" }}>
          <Link href="/catalog/changes"><Button variant="secondary">Change queue</Button></Link>
          <Link href={`/catalog/changes/new?entityType=${entityType}&operation=create`}><Button>Propose new</Button></Link>
        </div>
      </div>

      <SectionTitle>Entity type</SectionTitle>
      <select value={entityType} onChange={(e) => setEntityType(e.target.value as EntityType)} style={{ minHeight: "var(--size-touch)", padding: "0 var(--space-md)" }}>
        {ENTITY_TYPES.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>

      <div style={{ display: "flex", gap: "var(--space-sm)", margin: "var(--space-md) 0" }}>
        <TextInput label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ alignSelf: "flex-end" }}>
          <Button variant="secondary" loading={loading} onClick={() => void load()} disabled={loading}>Search</Button>
        </div>
      </div>

      <Table columns={columns} rows={rows} rowKey={(r) => r.id} emptyLabel={loading ? <PillSpinner label="Loading…" /> : "No entries found"} />
    </AdminShell>
  );
}
