"use client";
import Link from "next/link";
import { Banner, Button, Card, PillSpinner } from "@medpass/ui-web";
import { ProviderShell } from "../components/ProviderShell";
import { usePatients } from "../lib/hooks";
import { allowedProposalKinds, ORGANIZATION_KIND_LABELS, PROPOSAL_KIND_META } from "../lib/proposal-kinds";
import { useProviderSession } from "../lib/session";
import { formatDate, patientLabel } from "../lib/format";

/** Organization home: linked patients — labels only, no clinical data (docs_v2/05 §11). */
export default function HomePage() {
  return (
    <ProviderShell>
      <PatientsHome />
    </ProviderShell>
  );
}

function PatientsHome() {
  const { organization } = useProviderSession();
  const patients = usePatients();
  const kinds = organization ? allowedProposalKinds(organization.kind, organization.allowedProposalKinds) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "var(--space-sm)" }}>
        <h1 style={{ fontSize: "var(--font-title)", margin: 0 }}>Patients</h1>
        <Link href="/patients/add" style={{ textDecoration: "none" }}>
          <Button data-testid="add-patient">Add patient (scan QR)</Button>
        </Link>
      </div>
      {organization ? (
        <Banner tone="info">
          {ORGANIZATION_KIND_LABELS[organization.kind]} mode:{" "}
          {kinds.length > 0 ? kinds.map((k) => PROPOSAL_KIND_META[k].label.toLowerCase()).join(", ") : "this organization kind cannot send proposals yet"}.
          Everything you send is a proposal the patient accepts or declines.
        </Banner>
      ) : null}
      {patients.loading ? <PillSpinner label="Loading patients…" /> : null}
      {patients.error ? <Banner tone="danger">{patients.error}</Banner> : null}
      {patients.data && patients.data.length === 0 ? (
        <Card>
          <strong>No patients linked yet</strong>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            Ask the patient to open Medicine Passport, choose what to share with you, and show the QR code. Scan it with "Add patient".
          </span>
        </Card>
      ) : null}
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-sm)" }} data-testid="patients-list">
        {patients.data?.map((link) => (
          <li key={link.linkId}>
            <Link href={`/patients/${encodeURIComponent(link.linkId)}`} style={{ textDecoration: "none", color: "inherit" }}>
              <Card>
                <strong>{patientLabel(link.patient)}</strong>
                <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  Shares {link.sections.length} section{link.sections.length === 1 ? "" : "s"} · access until {formatDate(link.expiresAt)}
                </span>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
