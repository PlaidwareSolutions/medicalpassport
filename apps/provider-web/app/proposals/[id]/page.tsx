"use client";
import { use } from "react";
import Link from "next/link";
import { Banner, Button, Card, PillSpinner } from "@medpass/ui-web";
import { ProposalStatusChip } from "../../../components/ProposalStatusChip";
import { ProviderShell } from "../../../components/ProviderShell";
import { formatDateTime } from "../../../lib/format";
import { useProposal } from "../../../lib/hooks";
import { PROPOSAL_KIND_LABELS } from "../../../lib/proposal-kinds";
import { instructionSummary, type Instruction } from "../../../lib/transition";
import type { ProposalDto } from "../../../lib/types";

/** One proposal and its status — the provider's view of acceptance (ADR-V2-009). */
export default function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <ProviderShell maxWidth={760}>
      <ProposalView id={id} />
    </ProviderShell>
  );
}

function ProposalView({ id }: { id: string }) {
  const proposal = useProposal(id);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      {proposal.loading ? <PillSpinner label="Loading…" /> : null}
      {proposal.error ? <Banner tone="danger">{proposal.error}</Banner> : null}
      {proposal.data ? (
        <>
          <nav aria-label="Breadcrumb" style={{ fontSize: "var(--font-small)" }}>
            <Link href={`/patients/${encodeURIComponent(proposal.data.linkId)}`}>← Back to the patient</Link>
          </nav>
          <h1 style={{ fontSize: "var(--font-title)", margin: 0 }}>{PROPOSAL_KIND_LABELS[proposal.data.kind] ?? proposal.data.kind}</h1>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-sm)" }}>
            <ProposalStatusChip status={proposal.data.status} />
            <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
              Sent {formatDateTime(proposal.data.proposedAt)}
              {proposal.data.decidedAt ? ` · decided ${formatDateTime(proposal.data.decidedAt)}` : ""}
            </span>
            <Button variant="ghost" onClick={() => void proposal.reload()}>
              Refresh
            </Button>
          </div>
          {proposal.data.status === "proposed" ? (
            <Banner tone="info">Nothing in the patient's record has changed yet. They can accept this line by line, or decline it.</Banner>
          ) : null}
          {proposal.data.status === "accepted" ? <Banner tone="success">The patient accepted this. Their record now reflects it.</Banner> : null}
          {proposal.data.status === "rejected" ? <Banner tone="warning">The patient declined this. Nothing was changed.</Banner> : null}
          <Payload proposal={proposal.data} />
        </>
      ) : null}
    </div>
  );
}

interface LinePayload {
  decision: string;
  patientMedicationId?: string | null;
  proposedName?: string | null;
  proposedInstruction?: Instruction | null;
  reasonText?: string | null;
}

function Payload({ proposal }: { proposal: ProposalDto }) {
  const p = proposal.payload;
  const lines = Array.isArray(p.lines) ? (p.lines as LinePayload[]) : undefined;
  const items = Array.isArray(p.items) ? (p.items as Array<Record<string, unknown>>) : undefined;
  const results = Array.isArray(p.results) ? (p.results as Array<Record<string, unknown>>) : undefined;
  const text = (key: string) => (typeof p[key] === "string" && (p[key] as string).trim() ? (p[key] as string) : undefined);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      {lines ? (
        <>
          {lines
            .filter((l) => l.decision !== "STOP")
            .map((l, i) => (
              <Card key={i}>
                <strong>
                  {l.decision} · {l.proposedName ?? "Medicine on the patient's list"}
                </strong>
                {l.proposedInstruction ? <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{instructionSummary(l.proposedInstruction)}</span> : null}
                {l.reasonText ? <span style={{ fontSize: "var(--font-small)" }}>Reason: {l.reasonText}</span> : null}
              </Card>
            ))}
          {lines
            .filter((l) => l.decision === "STOP")
            .map((l, i) => (
              <Card key={`stop-${i}`} tone="danger">
                <strong>STOP · medicine on the patient's list</strong>
                {l.reasonText ? <span style={{ fontSize: "var(--font-small)" }}>Reason: {l.reasonText}</span> : null}
              </Card>
            ))}
        </>
      ) : null}
      {items
        ? items.map((it, i) => (
            <Card key={i}>
              <strong>
                {i + 1}. {String(it.enteredName ?? "")}
                {typeof it.strengthLabel === "string" ? ` ${it.strengthLabel}` : ""}
              </strong>
              <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                {[it.doseQuantity && it.doseUnit ? `${it.doseQuantity} ${it.doseUnit}` : null, it.pattern ?? it.frequencyCode, it.foodInstruction, it.durationDays ? `${it.durationDays} days` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {typeof it.instructionsText === "string" ? <span style={{ fontSize: "var(--font-small)" }}>{it.instructionsText}</span> : null}
            </Card>
          ))
        : null}
      {results ? (
        <Card>
          <strong>{text("title")}</strong>
          <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
            {results.map((r, i) => (
              <li key={i}>
                {String(r.analyteLabelText ?? r.analyteKey)}: {String(r.comparator ?? "")}
                {String(r.enteredValueText)} {String(r.enteredUnit ?? "")}
                {typeof r.referenceText === "string" ? ` (ref ${r.referenceText})` : ""}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {proposal.kind === "dispense" ? (
        <Card>
          <strong>{text("medicineName")}</strong>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            {String(p.quantity)} {String(p.unit)}
            {p.daysSupply ? ` · ${String(p.daysSupply)} days` : ""} · {formatDateTime(typeof p.dispensedAt === "string" ? p.dispensedAt : null)}
          </span>
          {text("notes") ? <span style={{ fontSize: "var(--font-small)" }}>{text("notes")}</span> : null}
        </Card>
      ) : null}
      {proposal.kind === "encounter" ? (
        <Card>
          <strong>
            {String(p.kind ?? "visit")} · {formatDateTime(typeof p.startedAt === "string" ? p.startedAt : null)}
          </strong>
          {text("reasonText") ? <span>{text("reasonText")}</span> : null}
          {text("diagnosisText") ? <span>Diagnosis: {text("diagnosisText")}</span> : null}
          {text("notes") ? <span style={{ fontSize: "var(--font-small)", whiteSpace: "pre-wrap" }}>{text("notes")}</span> : null}
          {typeof p.followUpOn === "string" ? <span style={{ fontSize: "var(--font-small)" }}>Follow-up {formatDateTime(p.followUpOn)}</span> : null}
        </Card>
      ) : null}
      {(text("diagnosisText") && proposal.kind !== "encounter") || text("summaryText") || (text("notes") && lines) ? (
        <Card>
          {text("diagnosisText") && proposal.kind !== "encounter" ? <span>Diagnosis: {text("diagnosisText")}</span> : null}
          {text("summaryText") ? <span style={{ whiteSpace: "pre-wrap", fontSize: "var(--font-small)" }}>{text("summaryText")}</span> : null}
          {text("notes") && lines ? <span style={{ whiteSpace: "pre-wrap", fontSize: "var(--font-small)" }}>{text("notes")}</span> : null}
        </Card>
      ) : null}
    </div>
  );
}
