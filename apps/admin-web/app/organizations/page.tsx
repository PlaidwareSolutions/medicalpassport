"use client";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, Chip, ChoiceGrid, PillSpinner, SectionTitle, Table, Tabs, TextInput } from "@medpass/ui-web";
import { AdminShell } from "../../components/AdminShell";
import { api } from "../../lib/api";
import {
  KIND_LABELS,
  ORGANIZATION_KINDS,
  shortId,
  useCanManageProviders,
  verificationTone,
  type DirectoryPage,
  type DirectoryScope,
  type GlobalOrganization,
  type OrganizationKind,
  type OrganizationRow,
} from "../../lib/providers";

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

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.problem.title : "Something went wrong";
}

interface CreateForm {
  kind: OrganizationKind;
  displayName: string;
  addressText: string;
  city: string;
  state: string;
  pincode: string;
}
const EMPTY_FORM: CreateForm = { kind: "clinic", displayName: "", addressText: "", city: "", state: "", pincode: "" };

/**
 * Organizations directory (provider_admin duty, docs_v2/14 §3): global
 * facility entries can be created, edited, HFR-verified and merged here.
 * Patient-entered facilities appear only as opaque ids with counts — the
 * API never sends their names, addresses or phones to an admin session.
 */
export default function AdminOrganizationsPage() {
  const canManage = useCanManageProviders();
  const [scope, setScope] = useState<DirectoryScope>("global");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<OrganizationKind | "">("");
  const [page, setPage] = useState<DirectoryPage<OrganizationRow> | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const [verifyTarget, setVerifyTarget] = useState<OrganizationRow | undefined>();
  const [hfrId, setHfrId] = useState("");
  const [mergeSource, setMergeSource] = useState<GlobalOrganization | undefined>();
  const [mergeInto, setMergeInto] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const params = new URLSearchParams({ scope, limit: "50" });
        if (q.trim()) params.set("q", q.trim());
        if (kind) params.set("kind", kind);
        if (cursor) params.set("cursor", cursor);
        const res = await api.get<DirectoryPage<OrganizationRow>>(`/admin/organizations?${params.toString()}`);
        setPage((prev) => (cursor && prev ? { ...res, items: [...prev.items, ...res.items] } : res));
      } catch (err) {
        setError(errorText(err));
      } finally {
        setLoading(false);
      }
    },
    [scope, q, kind],
  );

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  async function create() {
    setCreating(true);
    setError(undefined);
    try {
      const body = {
        kind: form.kind,
        displayName: form.displayName.trim(),
        addressText: form.addressText.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        pincode: form.pincode.trim() || null,
      };
      const created = await api.post<GlobalOrganization>("/admin/organizations", body);
      setNotice(`Created ${created.displayName}`);
      setForm(EMPTY_FORM);
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  async function verify() {
    if (!verifyTarget) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`/admin/organizations/${verifyTarget.id}/verify`, { hfrId: hfrId.trim() });
      setNotice(`Verified ${shortId(verifyTarget.id)} against HFR ${hfrId.trim()}`);
      setVerifyTarget(undefined);
      setHfrId("");
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function merge() {
    if (!mergeSource || !mergeInto) return;
    setBusy(true);
    setError(undefined);
    try {
      const survivor = await api.post<GlobalOrganization>(`/admin/organizations/${mergeSource.id}/merge`, { intoId: mergeInto });
      setNotice(`Merged ${mergeSource.displayName} into ${survivor.displayName}`);
      setMergeSource(undefined);
      setMergeInto("");
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const globalRows = (page?.items ?? []).filter((r): r is GlobalOrganization => !r.patientScoped);
  const cell = (row: OrganizationRow, text: string | null | undefined) =>
    row.patientScoped ? <span style={{ color: "var(--color-text-muted)" }}>—</span> : (text ?? "—");

  return (
    <AdminShell>
      <SectionTitle>Organizations</SectionTitle>
      {!canManage ? (
        <Banner tone="warning">Your admin account does not hold the provider_admin duty, so this page is unavailable.</Banner>
      ) : (
        <>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {notice ? <Banner tone="success">{notice}</Banner> : null}

          <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "flex-end", flexWrap: "wrap" }}>
            <Tabs
              label="Directory scope"
              tabs={[
                { key: "global", label: `Global directory${page ? ` (${page.totals.global})` : ""}` },
                { key: "patient", label: `Patient-entered${page ? ` (${page.totals.patient})` : ""}` },
                { key: "all", label: "All" },
              ]}
              value={scope}
              onChange={setScope}
            />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load();
            }}
            style={{ display: "flex", gap: "var(--space-md)", alignItems: "flex-end", flexWrap: "wrap", margin: "var(--space-md) 0" }}
          >
            <div style={{ flex: 1, minWidth: 220 }}>
              <TextInput label="Search global entries" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Facility name" />
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", fontWeight: 600 }}>
              Kind
              <select value={kind} onChange={(e) => setKind(e.target.value as OrganizationKind | "")} style={selectStyle}>
                <option value="">Any kind</option>
                {ORGANIZATION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="secondary" loading={loading}>
              Filter
            </Button>
            <Button type="button" onClick={() => setShowCreate((v) => !v)}>
              {showCreate ? "Close" : "New global entry"}
            </Button>
          </form>

          {showCreate ? (
            <Card>
              <strong>New global directory entry</strong>
              <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                Starts unverified. Verify with the HFR id once matched in the ABDM facility registry.
              </span>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
                style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}
              >
                <ChoiceGrid
                  label="Kind"
                  columns={3}
                  choices={ORGANIZATION_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
                  value={form.kind}
                  onChange={(v) => setForm((f) => ({ ...f, kind: v }))}
                />
                <TextInput label="Display name" required maxLength={160} value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
                <TextInput label="Address" maxLength={500} value={form.addressText} onChange={(e) => setForm((f) => ({ ...f, addressText: e.target.value }))} />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--space-md)" }}>
                  <TextInput label="City" maxLength={100} value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
                  <TextInput label="State" maxLength={100} value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} />
                  <TextInput label="PIN code" inputMode="numeric" pattern="\d{6}" maxLength={6} help="6 digits" value={form.pincode} onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value }))} />
                </div>
                <div>
                  <Button type="submit" loading={creating} disabled={!form.displayName.trim()}>
                    Create entry
                  </Button>
                </div>
              </form>
            </Card>
          ) : null}

          {verifyTarget ? (
            <Card>
              <strong>Verify {verifyTarget.patientScoped ? `patient entry ${shortId(verifyTarget.id)}` : verifyTarget.displayName} with HFR</strong>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void verify();
                }}
                style={{ display: "flex", gap: "var(--space-md)", alignItems: "flex-end", flexWrap: "wrap" }}
              >
                <div style={{ flex: 1, minWidth: 220 }}>
                  <TextInput label="HFR id" required value={hfrId} onChange={(e) => setHfrId(e.target.value)} help="ABDM Health Facility Registry id, as issued" />
                </div>
                <Button type="submit" loading={busy} disabled={hfrId.trim().length < 3}>
                  Mark provider-verified
                </Button>
                <Button type="button" variant="ghost" onClick={() => setVerifyTarget(undefined)}>
                  Cancel
                </Button>
              </form>
            </Card>
          ) : null}

          {mergeSource ? (
            <Card>
              <strong>Merge {mergeSource.displayName} into…</strong>
              <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                Every practitioner, encounter, immunization and procedure linked to it is repointed to the survivor; the duplicate is retired.
              </span>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void merge();
                }}
                style={{ display: "flex", gap: "var(--space-md)", alignItems: "flex-end", flexWrap: "wrap" }}
              >
                <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", fontWeight: 600, flex: 1, minWidth: 220 }}>
                  Survivor (global entries on this page)
                  <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} style={selectStyle} required>
                    <option value="">Choose…</option>
                    {globalRows
                      .filter((r) => r.id !== mergeSource.id)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.displayName} {r.city ? `· ${r.city}` : ""} ({shortId(r.id)})
                        </option>
                      ))}
                  </select>
                </label>
                <Button type="submit" variant="danger" loading={busy} disabled={!mergeInto}>
                  Merge
                </Button>
                <Button type="button" variant="ghost" onClick={() => setMergeSource(undefined)}>
                  Cancel
                </Button>
              </form>
            </Card>
          ) : null}

          {!page && loading ? <PillSpinner label="Loading…" /> : null}
          {page ? (
            <>
              <Table<OrganizationRow>
                rows={page.items}
                rowKey={(r) => r.id}
                emptyLabel="No organizations match"
                columns={[
                  {
                    key: "name",
                    header: "Name",
                    render: (r) =>
                      r.patientScoped ? (
                        <span style={{ color: "var(--color-text-muted)" }}>
                          Patient entry <code>{shortId(r.id)}</code>
                        </span>
                      ) : (
                        <>
                          <strong>{r.displayName}</strong>
                          {r.addressText ? <div style={{ color: "var(--color-text-muted)" }}>{r.addressText}</div> : null}
                        </>
                      ),
                  },
                  { key: "kind", header: "Kind", render: (r) => KIND_LABELS[r.kind] },
                  { key: "city", header: "City", render: (r) => cell(r, r.patientScoped ? null : [r.city, r.state].filter(Boolean).join(", ")) },
                  { key: "pincode", header: "PIN", render: (r) => cell(r, r.patientScoped ? null : r.pincode) },
                  {
                    key: "verification",
                    header: "Verification",
                    render: (r) => (
                      <>
                        <Chip tone={verificationTone(r.verification)}>{r.verification.replaceAll("_", " ")}</Chip>
                        {r.hfrId ? <div style={{ fontSize: "var(--font-small)" }}>HFR {r.hfrId}</div> : null}
                      </>
                    ),
                  },
                  { key: "practitioners", header: "Practitioners", render: (r) => r.practitionerCount },
                  { key: "encounters", header: "Encounters", render: (r) => r.encounterCount },
                  {
                    key: "actions",
                    header: "",
                    render: (r) => (
                      <div style={{ display: "flex", gap: "var(--space-xs)" }}>
                        {r.verification !== "provider_verified" ? (
                          <Button variant="ghost" type="button" onClick={() => { setVerifyTarget(r); setHfrId(""); }}>
                            Verify
                          </Button>
                        ) : null}
                        {!r.patientScoped ? (
                          <Button variant="ghost" type="button" onClick={() => { setMergeSource(r); setMergeInto(""); }}>
                            Merge
                          </Button>
                        ) : null}
                      </div>
                    ),
                  },
                ]}
              />
              {page.nextCursor ? (
                <div style={{ marginTop: "var(--space-md)" }}>
                  <Button variant="secondary" loading={loading} onClick={() => void load(page.nextCursor!)}>
                    Load more
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
          <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)", maxWidth: "70ch" }}>
            Patient-entered facilities are part of the patient record: only their opaque id, kind and link counts reach this
            page, and the name search never matches them. Every write here is audited.
          </p>
        </>
      )}
    </AdminShell>
  );
}
