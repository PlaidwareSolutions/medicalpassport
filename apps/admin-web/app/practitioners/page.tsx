"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, Chip, PillSpinner, SectionTitle, Table, Tabs, TextInput } from "@medpass/ui-web";
import { AdminShell } from "../../components/AdminShell";
import { api } from "../../lib/api";
import {
  shortId,
  useCanManageProviders,
  verificationTone,
  type DirectoryPage,
  type DirectoryScope,
  type PractitionerRow,
} from "../../lib/providers";

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.problem.title : "Something went wrong";
}

/**
 * Practitioners directory (provider_admin duty, docs_v2/14 §3): HPR
 * verification of global and patient-entered practitioner rows. Patient
 * entries are shown as opaque ids with usage counts only — the API never
 * sends a patient-entered doctor name to an admin session.
 */
export default function AdminPractitionersPage() {
  const canManage = useCanManageProviders();
  const [scope, setScope] = useState<DirectoryScope>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState<DirectoryPage<PractitionerRow> | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const [target, setTarget] = useState<PractitionerRow | undefined>();
  const [hprId, setHprId] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [registrationCouncil, setRegistrationCouncil] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const params = new URLSearchParams({ scope, limit: "50" });
        if (q.trim()) params.set("q", q.trim());
        if (cursor) params.set("cursor", cursor);
        const res = await api.get<DirectoryPage<PractitionerRow>>(`/admin/practitioners?${params.toString()}`);
        setPage((prev) => (cursor && prev ? { ...res, items: [...prev.items, ...res.items] } : res));
      } catch (err) {
        setError(errorText(err));
      } finally {
        setLoading(false);
      }
    },
    [scope, q],
  );

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  function startVerify(row: PractitionerRow) {
    setTarget(row);
    setHprId(row.hprId ?? "");
    setRegistrationNumber(row.patientScoped ? "" : (row.registrationNumber ?? ""));
    setRegistrationCouncil(row.patientScoped ? "" : (row.registrationCouncil ?? ""));
  }

  async function verify() {
    if (!target) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`/admin/practitioners/${target.id}/verify`, {
        hprId: hprId.trim(),
        ...(registrationNumber.trim() ? { registrationNumber: registrationNumber.trim() } : {}),
        ...(registrationCouncil.trim() ? { registrationCouncil: registrationCouncil.trim() } : {}),
      });
      setNotice(`Verified ${target.patientScoped ? shortId(target.id) : target.displayName} against HPR ${hprId.trim()}`);
      setTarget(undefined);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <SectionTitle>Practitioners</SectionTitle>
      {!canManage ? (
        <Banner tone="warning">Your admin account does not hold the provider_admin duty, so this page is unavailable.</Banner>
      ) : (
        <>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {notice ? <Banner tone="success">{notice}</Banner> : null}

          <Tabs
            label="Directory scope"
            tabs={[
              { key: "all", label: "All" },
              { key: "global", label: `Global directory${page ? ` (${page.totals.global})` : ""}` },
              { key: "patient", label: `Patient-entered${page ? ` (${page.totals.patient})` : ""}` },
            ]}
            value={scope}
            onChange={setScope}
          />

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load();
            }}
            style={{ display: "flex", gap: "var(--space-md)", alignItems: "flex-end", flexWrap: "wrap", margin: "var(--space-md) 0" }}
          >
            <div style={{ flex: 1, minWidth: 220 }}>
              <TextInput label="Search global entries" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, registration number or HPR id" />
            </div>
            <Button type="submit" variant="secondary" loading={loading}>
              Filter
            </Button>
          </form>

          {target ? (
            <Card>
              <strong>Verify {target.patientScoped ? `patient entry ${shortId(target.id)}` : target.displayName} with HPR</strong>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void verify();
                }}
                style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}
              >
                <TextInput label="HPR id" required value={hprId} onChange={(e) => setHprId(e.target.value)} help="ABDM Health Professional Registry id, as issued" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-md)" }}>
                  <TextInput label="Registration number (optional)" maxLength={60} value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} />
                  <TextInput label="Registration council (optional)" maxLength={120} value={registrationCouncil} onChange={(e) => setRegistrationCouncil(e.target.value)} />
                </div>
                <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                  <Button type="submit" loading={busy} disabled={hprId.trim().length < 3}>
                    Mark provider-verified
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setTarget(undefined)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </Card>
          ) : null}

          {!page && loading ? <PillSpinner label="Loading…" /> : null}
          {page ? (
            <>
              <Table<PractitionerRow>
                rows={page.items}
                rowKey={(r) => r.id}
                emptyLabel="No practitioners match"
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
                          {r.speciality ? <div style={{ color: "var(--color-text-muted)" }}>{r.speciality}</div> : null}
                        </>
                      ),
                  },
                  {
                    key: "registration",
                    header: "Registration",
                    render: (r) =>
                      r.patientScoped ? (
                        <span style={{ color: "var(--color-text-muted)" }}>—</span>
                      ) : (
                        [r.registrationNumber, r.registrationCouncil].filter(Boolean).join(" · ") || "—"
                      ),
                  },
                  {
                    key: "verification",
                    header: "Verification",
                    render: (r) => (
                      <>
                        <Chip tone={verificationTone(r.verification)}>{r.verification.replaceAll("_", " ")}</Chip>
                        {r.hprId ? <div style={{ fontSize: "var(--font-small)" }}>HPR {r.hprId}</div> : null}
                      </>
                    ),
                  },
                  { key: "medications", header: "Meds", render: (r) => r.medicationCount },
                  { key: "prescriptions", header: "Rx", render: (r) => r.prescriptionCount },
                  { key: "reports", header: "Reports", render: (r) => r.reportCount },
                  { key: "encounters", header: "Encounters", render: (r) => r.encounterCount },
                  {
                    key: "actions",
                    header: "",
                    render: (r) =>
                      r.verification !== "provider_verified" ? (
                        <Button variant="ghost" type="button" onClick={() => startVerify(r)}>
                          Verify
                        </Button>
                      ) : null,
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
            Patient-entered doctors are part of the patient record: only their opaque id, verification and usage counts
            reach this page, and the search never matches them. Every verification is audited.
          </p>
        </>
      )}
    </AdminShell>
  );
}
