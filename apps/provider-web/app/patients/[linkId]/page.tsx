"use client";
import { use } from "react";
import Link from "next/link";
import { Banner, Button, Card, PillSpinner } from "@medpass/ui-web";
import { ProposalStatusChip } from "../../../components/ProposalStatusChip";
import { ProviderShell } from "../../../components/ProviderShell";
import { useProposals, useSnapshot } from "../../../lib/hooks";
import { formatDate, formatDateTime, patientLabel } from "../../../lib/format";
import { SECTION_LABELS } from "../../../lib/patient-links";
import { allowedProposalKinds, PROPOSAL_KIND_LABELS, PROPOSAL_KIND_META } from "../../../lib/proposal-kinds";
import { useProviderSession } from "../../../lib/session";
import { currentInstructionLabel, parseInstruction } from "../../../lib/transition";
import type { SnapshotDto } from "../../../lib/types";

/**
 * The timeline projects a medicine change with the medicine's name under
 * `name` (packages/health-events `projectMedicationChange`). Reading the
 * wrong key left the list saying "medicine started" three times over with
 * nothing to tell the three apart. `medicationName` is the visit summary's
 * spelling of the same thing and is accepted as a fallback.
 */
function changedMedicineName(summary: unknown): string | null {
  if (!summary || typeof summary !== "object") return null;
  const s = summary as { name?: unknown; medicationName?: unknown };
  const name = typeof s.name === "string" ? s.name : typeof s.medicationName === "string" ? s.medicationName : null;
  return name && name.trim() ? name : null;
}

/** Encounter kinds as a clinician reads them, not as the column stores them. */
const ENCOUNTER_KIND_LABELS: Record<string, string> = {
  outpatient: "Clinic visit",
  inpatient: "Hospital stay",
  emergency: "Emergency",
  teleconsult: "Phone or video consultation",
  pharmacy: "Pharmacy visit",
  lab_visit: "Laboratory visit",
  home: "Home visit",
};

/** Patient snapshot (read-only, granted sections only), the workflows this organization may start, and its proposals with status. */
export default function PatientPage({ params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = use(params);
  return (
    <ProviderShell>
      <PatientView linkId={linkId} />
    </ProviderShell>
  );
}

function PatientView({ linkId }: { linkId: string }) {
  const { organization } = useProviderSession();
  const snapshot = useSnapshot(linkId);
  const proposals = useProposals(linkId);
  const kinds = organization ? allowedProposalKinds(organization.kind, organization.allowedProposalKinds) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <nav aria-label="Breadcrumb" style={{ fontSize: "var(--font-small)" }}>
        <Link href="/">← All patients</Link>
      </nav>
      {snapshot.loading ? <PillSpinner label="Loading the patient's shared record…" /> : null}
      {snapshot.error ? <Banner tone="danger">{snapshot.error}</Banner> : null}
      {snapshot.data ? (
        <>
          <header>
            <h1 style={{ fontSize: "var(--font-title)", margin: 0 }} data-testid="patient-name">
              {patientLabel(snapshot.data.profile)}
            </h1>
            <p style={{ margin: "var(--space-xs) 0 0", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
              Shared: {snapshot.data.sections.map((s) => SECTION_LABELS[s] ?? s).join(", ")} · as of {formatDateTime(snapshot.data.generatedAt)}
            </p>
          </header>
          <Banner tone="info">This is the patient's own record, shown as they chose to share it. Anything you send is a proposal; they decide what to accept.</Banner>

          <section aria-labelledby="actions-heading">
            <h2 id="actions-heading" style={{ fontSize: "var(--font-large)", margin: "0 0 var(--space-sm)" }}>
              What would you like to record?
            </h2>
            {kinds.length === 0 ? <p style={{ color: "var(--color-text-muted)" }}>This organization kind cannot send proposals.</p> : null}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-sm)" }}>
              {kinds.map((kind) => (
                <Link key={kind} href={`/patients/${encodeURIComponent(linkId)}/${PROPOSAL_KIND_META[kind].route}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <Card>
                    <strong data-testid={`action-${kind}`}>{PROPOSAL_KIND_META[kind].label}</strong>
                    <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{PROPOSAL_KIND_META[kind].description}</span>
                  </Card>
                </Link>
              ))}
            </div>
          </section>

          <Snapshot snapshot={snapshot.data} />
        </>
      ) : null}

      <section aria-labelledby="proposals-heading">
        <h2 id="proposals-heading" style={{ fontSize: "var(--font-large)", margin: "0 0 var(--space-sm)" }}>
          Proposals sent to this patient
        </h2>
        {proposals.loading ? <PillSpinner label="Loading proposals…" /> : null}
        {proposals.error ? <Banner tone="danger">{proposals.error}</Banner> : null}
        {proposals.data && proposals.data.length === 0 ? <p style={{ color: "var(--color-text-muted)" }}>Nothing sent yet.</p> : null}
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-sm)" }} data-testid="proposals-list">
          {proposals.data?.map((p) => (
            <li key={p.id}>
              <Link href={`/proposals/${encodeURIComponent(p.id)}`} style={{ textDecoration: "none", color: "inherit" }}>
                <Card>
                  <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "var(--space-sm)", alignItems: "center" }}>
                    <div>
                      <strong>{PROPOSAL_KIND_LABELS[p.kind] ?? p.kind}</strong>
                      <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                        Sent {formatDateTime(p.proposedAt)}
                        {p.decidedAt ? ` · decided ${formatDateTime(p.decidedAt)}` : ""}
                      </div>
                    </div>
                    <ProposalStatusChip status={p.status} />
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
        {proposals.data ? (
          <Button variant="ghost" onClick={() => void proposals.reload()} style={{ marginTop: "var(--space-sm)" }}>
            Refresh status
          </Button>
        ) : null}
      </section>
    </div>
  );
}

function Snapshot({ snapshot }: { snapshot: SnapshotDto }) {
  return (
    <section aria-labelledby="snapshot-heading" style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      <h2 id="snapshot-heading" style={{ fontSize: "var(--font-large)", margin: 0 }}>
        Shared record (read-only)
      </h2>
      {snapshot.currentMedications ? (
        <Card>
          <strong>Current medicines</strong>
          {snapshot.currentMedications.length === 0 ? <span style={{ color: "var(--color-text-muted)" }}>None on record.</span> : null}
          <ul style={{ margin: 0, paddingLeft: "1.2em" }} data-testid="snapshot-medications">
            {snapshot.currentMedications.map((m, i) => (
              <li key={m.patientMedicationId ?? i}>
                <strong>{m.name}</strong>
                {m.strengthLabel ? ` ${m.strengthLabel}` : ""} —{" "}
                {currentInstructionLabel({ instruction: parseInstruction(m.instruction), instructionSummary: m.instructionSummary }) || "no instruction recorded"}
                {m.prescriberName ? ` · ${m.prescriberName}` : ""}
                {m.startDate ? ` · since ${formatDate(m.startDate)}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {snapshot.allergies ? (
        <Card tone={snapshot.allergies.length > 0 ? "warning" : "default"}>
          <strong>Allergies</strong>
          {snapshot.allergies.length === 0 ? <span style={{ color: "var(--color-text-muted)" }}>None recorded.</span> : null}
          <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
            {snapshot.allergies.map((a, i) => (
              <li key={i}>
                <strong>{a.label}</strong> · {a.severity}
                {a.reactionNote ? ` · ${a.reactionNote}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {snapshot.majorConditions ? (
        <Card>
          <strong>Conditions</strong>
          {snapshot.majorConditions.length === 0 ? <span style={{ color: "var(--color-text-muted)" }}>None recorded.</span> : null}
          <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
            {snapshot.majorConditions.map((c, i) => (
              <li key={i}>
                <strong>{c.label}</strong>
                {c.clinicalStatus ? ` · ${c.clinicalStatus}` : ""}
                {c.onsetDate ? ` · since ${formatDate(c.onsetDate)}` : ""}
                {c.note ? ` · ${c.note}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {snapshot.latestResults ? (
        <Card>
          <strong>Latest results</strong>
          {snapshot.latestResults.length === 0 ? <span style={{ color: "var(--color-text-muted)" }}>No results on record.</span> : null}
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "var(--font-small)" }}>
              <thead>
                <tr>
                  {["Test", "Value", "Unit", "Reference", "When"].map((h) => (
                    <th key={h} scope="col" style={{ textAlign: "start", padding: "var(--space-xs)", borderBottom: "1px solid var(--color-border)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshot.latestResults.map((r, i) => (
                  <tr key={i}>
                    <td style={{ padding: "var(--space-xs)" }}>{r.label}</td>
                    <td style={{ padding: "var(--space-xs)" }}>
                      {r.comparator ?? ""}
                      {r.value}
                      {r.interpretation && r.interpretation !== "normal" ? ` (${r.interpretation.replace(/_/g, " ")})` : ""}
                    </td>
                    <td style={{ padding: "var(--space-xs)" }}>{r.unit ?? "—"}</td>
                    <td style={{ padding: "var(--space-xs)" }}>{r.referenceText ?? "—"}</td>
                    <td style={{ padding: "var(--space-xs)" }}>{formatDate(r.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
      {snapshot.recentChanges ? (
        <Card>
          <strong>Recent changes (90 days)</strong>
          {snapshot.recentChanges.length === 0 ? <span style={{ color: "var(--color-text-muted)" }}>No medicine changes.</span> : null}
          <ul style={{ margin: 0, paddingLeft: "1.2em" }} data-testid="snapshot-recent-changes">
            {snapshot.recentChanges.map((c, i) => {
              const name = changedMedicineName(c.summary);
              return (
                <li key={i}>
                  {name ? <strong>{name}</strong> : null}
                  {name ? " · " : ""}
                  {c.kind.replace(/_/g, " ")} · {formatDate(c.occurredAt)}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
      {snapshot.encounters ? (
        <Card>
          <strong>Visits</strong>
          {snapshot.encounters.length === 0 ? <span style={{ color: "var(--color-text-muted)" }}>No visits on record.</span> : null}
          <ul style={{ margin: 0, paddingLeft: "1.2em" }} data-testid="snapshot-encounters">
            {snapshot.encounters.map((e, i) => (
              <li key={i}>
                <strong>{ENCOUNTER_KIND_LABELS[e.kind] ?? e.kind.replace(/_/g, " ")}</strong> · {formatDate(e.startedAt)}
                {e.organizationName ? ` · ${e.organizationName}` : ""}
                {e.practitionerName ? ` · ${e.practitionerName}` : ""}
                {e.diagnosisText ? ` · ${e.diagnosisText}` : e.reasonText ? ` · ${e.reasonText}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {snapshot.bloodPressureReadings ? (
        <Card>
          <strong>Blood pressure (30 days)</strong>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }} data-testid="snapshot-blood-pressure">
            {snapshot.bloodPressureReadings.readingCount === 0
              ? "No readings recorded."
              : `${snapshot.bloodPressureReadings.readingCount} reading${snapshot.bloodPressureReadings.readingCount === 1 ? "" : "s"} · average ${snapshot.bloodPressureReadings.averageSystolic ?? "—"}/${snapshot.bloodPressureReadings.averageDiastolic ?? "—"} mmHg`}
          </span>
          <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
            {snapshot.bloodPressureReadings.recent.map((r, i) => (
              <li key={i}>
                {r.systolic}/{r.diastolic} mmHg{r.pulseBpm ? ` · pulse ${r.pulseBpm}` : ""} · {formatDate(r.measuredAt)}
                {r.note ? ` · ${r.note}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {snapshot.glucoseReadings ? (
        <Card>
          <strong>Glucose diary (30 days)</strong>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }} data-testid="snapshot-glucose">
            {snapshot.glucoseReadings.readingCount === 0
              ? "No readings recorded."
              : `${snapshot.glucoseReadings.readingCount} reading${snapshot.glucoseReadings.readingCount === 1 ? "" : "s"} · average ${snapshot.glucoseReadings.averageMgDl ?? "—"} mg/dL · lowest ${snapshot.glucoseReadings.lowestMgDl ?? "—"} · highest ${snapshot.glucoseReadings.highestMgDl ?? "—"}`}
          </span>
          <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
            {snapshot.glucoseReadings.recent.map((r, i) => (
              <li key={i}>
                {r.valueMgDl} mg/dL · {r.context.replace(/_/g, " ")} · {formatDate(r.measuredAt)}
                {r.note ? ` · ${r.note}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {snapshot.weightReadings ? (
        <Card>
          <strong>Weight (30 days)</strong>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }} data-testid="snapshot-weight">
            {snapshot.weightReadings.readingCount === 0
              ? "No readings recorded."
              : `Latest ${snapshot.weightReadings.latestKg ?? "—"} kg${snapshot.weightReadings.changeKg ? ` · ${snapshot.weightReadings.changeKg} kg across the window` : ""}`}
          </span>
        </Card>
      ) : null}
      {snapshot.measurements ? (
        <Card>
          <strong>Home measurements (30 days)</strong>
          {snapshot.measurements.length === 0 ? <span style={{ color: "var(--color-text-muted)" }}>Nothing recorded.</span> : null}
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "var(--font-small)" }} data-testid="snapshot-measurements">
              <thead>
                <tr>
                  {["Measurement", "Latest", "Lowest", "Highest", "Average", "Readings"].map((h) => (
                    <th key={h} scope="col" style={{ textAlign: "start", padding: "var(--space-xs)", borderBottom: "1px solid var(--color-border)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshot.measurements.map((m) => (
                  <tr key={m.concept}>
                    <td style={{ padding: "var(--space-xs)" }}>
                      {m.label} ({m.unit})
                    </td>
                    <td style={{ padding: "var(--space-xs)" }}>
                      {m.latest ? `${m.latest.value}${m.latest.value2 ? `/${m.latest.value2}` : ""} · ${formatDate(m.latest.measuredAt)}` : "—"}
                    </td>
                    <td style={{ padding: "var(--space-xs)" }}>{m.minimum ?? "—"}</td>
                    <td style={{ padding: "var(--space-xs)" }}>{m.maximum ?? "—"}</td>
                    <td style={{ padding: "var(--space-xs)" }}>
                      {m.average ?? "—"}
                      {m.average2 ? `/${m.average2}` : ""}
                    </td>
                    <td style={{ padding: "var(--space-xs)" }}>{m.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
      {snapshot.checkups ? (
        <Card>
          <strong>Check-ups</strong>
          {snapshot.checkups.length === 0 ? <span style={{ color: "var(--color-text-muted)" }}>None recorded.</span> : null}
          <ul style={{ margin: 0, paddingLeft: "1.2em" }} data-testid="snapshot-checkups">
            {snapshot.checkups.map((c, i) => (
              <li key={i}>
                {formatDate(c.checkupDate)}
                {c.hba1cPercent ? ` · HbA1c ${c.hba1cPercent}%` : ""}
                {c.fastingGlucoseMgDl ? ` · fasting ${c.fastingGlucoseMgDl} mg/dL` : ""}
                {c.bloodPressureSystolic && c.bloodPressureDiastolic ? ` · BP ${c.bloodPressureSystolic}/${c.bloodPressureDiastolic} mmHg` : ""}
                {c.weightKg ? ` · ${c.weightKg} kg` : ""}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {snapshot.prescriptions ? (
        <Card>
          <strong>Prescriptions</strong>
          {snapshot.prescriptions.length === 0 ? <span style={{ color: "var(--color-text-muted)" }}>None on record.</span> : null}
          <ul style={{ margin: 0, paddingLeft: "1.2em" }} data-testid="snapshot-prescriptions">
            {snapshot.prescriptions.map((pr, i) => (
              <li key={i}>
                {pr.prescribedAt ? formatDate(pr.prescribedAt) : "Date not recorded"}
                {pr.practitionerName ? ` · ${pr.practitionerName}` : ""} · {pr.medicationCount} medicine{pr.medicationCount === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {snapshot.unresolvedConcerns ? (
        <Card tone={snapshot.unresolvedConcerns.length > 0 ? "warning" : "default"}>
          <strong>Concerns the patient raised</strong>
          {snapshot.unresolvedConcerns.length === 0 ? <span style={{ color: "var(--color-text-muted)" }}>None open.</span> : null}
          <ul style={{ margin: 0, paddingLeft: "1.2em" }} data-testid="snapshot-concerns">
            {snapshot.unresolvedConcerns.map((c, i) => (
              <li key={i}>
                {c.summary} · {c.category.replace(/_/g, " ")} · {c.severity}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {snapshot.documents ? (
        <Card>
          <strong>Documents</strong>
          <span style={{ color: "var(--color-text-muted)" }}>
            {snapshot.documents.length} document{snapshot.documents.length === 1 ? "" : "s"} on file (metadata only).
          </span>
        </Card>
      ) : null}
    </section>
  );
}
