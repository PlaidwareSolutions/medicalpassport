"use client";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Banner, Button, Card, Chip, PillSpinner, SectionTitle, Table, TextInput, type TableColumn } from "@medpass/ui-web";
import { AdminShell } from "../../components/AdminShell";
import { api } from "../../lib/api";
import { errorText, useHasDuty, when, type FeatureFlagRow } from "../../lib/platform";

const selectStyle: CSSProperties = {
  minHeight: "var(--size-touch)",
  padding: "0 var(--space-md)",
  borderRadius: "var(--radius-sm)",
  border: "2px solid var(--color-border)",
  fontSize: "var(--font-body)",
  fontFamily: "var(--font-family)",
  color: "var(--color-text)",
  background: "var(--color-bg)",
};

interface FlagForm {
  key: string;
  description: string;
  defaultOn: boolean;
  rolloutPercent: string;
  allowProfileIds: string;
  environment: string;
  note: string;
}
const EMPTY: FlagForm = { key: "", description: "", defaultOn: false, rolloutPercent: "0", allowProfileIds: "", environment: "", note: "" };

/**
 * Configuration / feature flags (super_admin, docs_v2/14 §3). The editor
 * behind `GET meta/flags`: env-seeded defaults listed alongside the rows
 * that override them; every save needs a note that lands on the audit
 * chain. Allowlisted profile ids are pasted as opaque ids — this page
 * never resolves them to a person.
 */
export default function ConfigurationPage() {
  const allowed = useHasDuty("super_admin");
  const [rows, setRows] = useState<FeatureFlagRow[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [form, setForm] = useState<FlagForm | undefined>();
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const res = await api.get<{ items: FeatureFlagRow[] }>("/admin/flags");
      setRows(res.items);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  function edit(row?: FeatureFlagRow) {
    setNotice(undefined);
    setForm(
      row
        ? {
            key: row.key,
            description: row.description ?? "",
            defaultOn: row.defaultOn,
            rolloutPercent: String(row.rolloutPercent),
            allowProfileIds: row.allowProfileIds.join("\n"),
            environment: row.environment ?? "",
            note: "",
          }
        : EMPTY,
    );
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(undefined);
    try {
      const body = {
        description: form.description.trim() || null,
        defaultOn: form.defaultOn,
        rolloutPercent: Number(form.rolloutPercent),
        allowProfileIds: form.allowProfileIds
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        environment: form.environment || null,
        note: form.note.trim(),
      };
      await api.request<FeatureFlagRow>("PUT", `/admin/flags/${encodeURIComponent(form.key.trim())}`, body);
      setNotice(`Saved ${form.key.trim()} — the note is on the audit chain.`);
      setForm(undefined);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  const columns: TableColumn<FeatureFlagRow>[] = [
    { key: "key", header: "Flag", render: (r) => <code>{r.key}</code> },
    { key: "source", header: "Source", render: (r) => <Chip tone={r.source === "row" ? "success" : "default"}>{r.source === "row" ? "row" : "env default"}</Chip> },
    { key: "defaultOn", header: "Default", render: (r) => (r.defaultOn ? "on" : "off") },
    { key: "rollout", header: "Rollout", render: (r) => `${r.rolloutPercent}%` },
    { key: "allow", header: "Allowlist", render: (r) => `${r.allowProfileIds.length} profile(s)` },
    { key: "env", header: "Environment", render: (r) => r.environment ?? "all" },
    { key: "updated", header: "Updated", render: (r) => when(r.updatedAt) },
    { key: "edit", header: "", render: (r) => <Button variant="secondary" onClick={() => edit(r)}>Edit</Button> },
  ];

  return (
    <AdminShell>
      <h1 style={{ fontSize: "var(--font-title)" }}>Configuration — feature flags</h1>
      {!allowed ? (
        <Banner tone="warning">Feature flags are edited by super_admin only.</Banner>
      ) : (
        <>
          <p style={{ color: "var(--color-text-muted)" }}>
            Flags gate what patients see, never what they may do. Rollout buckets profiles by a stable hash of the profile id; the allowlist wins over the
            percentage. Every save is written to the audit chain with your note.
          </p>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {notice ? <Banner tone="success">{notice}</Banner> : null}
          <div style={{ margin: "var(--space-sm) 0" }}>
            <Button onClick={() => edit()}>New flag</Button>
          </div>
          {form ? (
            <Card tone="info">
              <SectionTitle>{rows?.some((r) => r.key === form.key && r.source === "row") ? `Edit ${form.key}` : "Flag"}</SectionTitle>
              <TextInput label="Key" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} help="camelCase or snake_case; a static key can be overridden by a row" />
              <TextInput label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <label style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
                <input type="checkbox" checked={form.defaultOn} onChange={(e) => setForm({ ...form, defaultOn: e.target.checked })} /> Default on
              </label>
              <TextInput label="Rollout percent (0–100)" type="number" min={0} max={100} value={form.rolloutPercent} onChange={(e) => setForm({ ...form, rolloutPercent: e.target.value })} />
              <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                <span>Allowlisted profile ids (one per line — opaque ids only)</span>
                <textarea rows={4} value={form.allowProfileIds} onChange={(e) => setForm({ ...form, allowProfileIds: e.target.value })} style={{ ...selectStyle, padding: "var(--space-sm)" }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                <span>Environment</span>
                <select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })} style={selectStyle}>
                  <option value="">All environments</option>
                  {["development", "test", "staging", "production"].map((env) => (
                    <option key={env} value={env}>
                      {env}
                    </option>
                  ))}
                </select>
              </label>
              <TextInput label="Audit note (why)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} help="Required; recorded with the change" />
              <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                <Button loading={saving} disabled={!form.key.trim() || form.note.trim().length < 3} onClick={() => void save()}>
                  Save
                </Button>
                <Button variant="secondary" onClick={() => setForm(undefined)}>
                  Cancel
                </Button>
              </div>
            </Card>
          ) : null}
          <div style={{ marginTop: "var(--space-md)" }}>
            {!rows ? <PillSpinner label="Loading…" /> : <Table columns={columns} rows={rows} rowKey={(r) => r.key} emptyLabel="No flags" />}
          </div>
        </>
      )}
    </AdminShell>
  );
}
