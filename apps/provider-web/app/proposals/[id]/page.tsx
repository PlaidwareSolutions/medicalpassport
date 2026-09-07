"use client";
import { use } from "react";
import Link from "next/link";
import { Banner, Button, Card, Chip, PillSpinner } from "@medpass/ui-web";
import { ProposalStatusChip } from "../../../components/ProposalStatusChip";
import { ProviderShell } from "../../../components/ProviderShell";
import { formatDate, formatDateTime } from "../../../lib/format";
import { useAnalytes, useProposal } from "../../../lib/hooks";
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
          <Decision proposal={proposal.data} />
          <Payload proposal={proposal.data} />
        </>
      ) : null}
    </div>
  );
}

/**
 * What the patient decided, in their terms. "Accepted" alone hides a partial
 * acceptance: the clinic needs to know which line was refused, because the
 * medicine on that line is still exactly as it was. The lines themselves are
 * marked below; this states the outcome and carries the patient's reason
 * when they gave one (the app tells them the sending clinic will see it).
 */
function Decision({ proposal }: { proposal: ProposalDto }) {
  const lines = Array.isArray(proposal.payload.lines) ? (proposal.payload.lines as LinePayload[]) : undefined;
  const declined = proposal.declinedLines ?? [];

  if (proposal.status === "rejected") {
    return (
      <Banner tone="warning">
        <div data-testid="proposal-decision">
          The patient declined this. Nothing was changed.
          {proposal.decisionReason ? <div style={{ marginTop: "var(--space-xs)" }}>They said: “{proposal.decisionReason}”</div> : null}
        </div>
      </Banner>
    );
  }
  if (proposal.status !== "accepted") return null;
  if (declined.length === 0) {
    return (
      <Banner tone="success">
        <span data-testid="proposal-decision">
          The patient accepted this. Their record now reflects it.
          {lines ? " Every line was accepted." : ""}
        </span>
      </Banner>
    );
  }
  return (
    <Banner tone="warning">
      <div data-testid="proposal-decision">
        The patient accepted {(lines?.length ?? 0) - declined.length} of {lines?.length ?? 0} lines and said no to{" "}
        {declined.length === 1 ? "one" : declined.length}. The lines they declined are marked below and are unchanged in their record.
      </div>
    </Banner>
  );
}

interface LinePayload {
  decision: string;
  patientMedicationId?: string | null;
  proposedName?: string | null;
  proposedInstruction?: Instruction | null;
  reasonText?: string | null;
}

/** A medicine name every line now carries; older proposals, sent before it did, keep the honest placeholder. */
function lineName(line: LinePayload): string {
  return line.proposedName?.trim() || "Medicine on the patient's list";
}

function Payload({ proposal }: { proposal: ProposalDto }) {
  const p = proposal.payload;
  const analytes = useAnalytes();
  const lines = Array.isArray(p.lines) ? (p.lines as LinePayload[]).map((line, index) => ({ line, index })) : undefined;
  const items = Array.isArray(p.items) ? (p.items as Array<Record<string, unknown>>) : undefined;
  const results = Array.isArray(p.results) ? (p.results as Array<Record<string, unknown>>) : undefined;
  const text = (key: string) => (typeof p[key] === "string" && (p[key] as string).trim() ? (p[key] as string) : undefined);
  const declined = new Set(proposal.declinedLines ?? []);
  // The analyte's display name ("HbA1c"), never the storage key ("hba1c") —
  // that key is an internal handle nobody outside the codebase reads.
  const analyteLabel = (r: Record<string, unknown>) => {
    if (typeof r.analyteLabelText === "string" && r.analyteLabelText.trim()) return r.analyteLabelText;
    const key = String(r.analyteKey ?? "");
    return analytes.data?.items.find((a) => a.key === key)?.display ?? key;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      {lines ? (
        <>
          {lines
            .filter(({ line }) => line.decision !== "STOP")
            .map(({ line, index }) => (
              <Card key={index} data-testid="proposal-line" data-declined={declined.has(index) ? "true" : "false"}>
                <strong>
                  {line.decision} · {lineName(line)}
                </strong>
                {line.proposedInstruction ? (
                  <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{instructionSummary(line.proposedInstruction)}</span>
                ) : null}
                {line.reasonText ? <span style={{ fontSize: "var(--font-small)" }}>Reason: {line.reasonText}</span> : null}
                {declined.has(index) ? <Chip tone="warning">The patient said no to this line</Chip> : null}
              </Card>
            ))}
          {lines
            .filter(({ line }) => line.decision === "STOP")
            .map(({ line, index }) => (
              <Card key={`stop-${index}`} tone="danger" data-testid="proposal-line" data-declined={declined.has(index) ? "true" : "false"}>
                <strong>STOP · {lineName(line)}</strong>
                {line.reasonText ? <span style={{ fontSize: "var(--font-small)" }}>Reason: {line.reasonText}</span> : null}
                {declined.has(index) ? <Chip tone="warning">The patient said no to this line — they are still taking it</Chip> : null}
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
                {analyteLabel(r)}: {String(r.comparator ?? "")}
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
          {/* A follow-up is a day the patient comes back, never a time of day: "12:00 am" was the absence of one. */}
          {typeof p.followUpOn === "string" ? <span style={{ fontSize: "var(--font-small)" }}>Follow-up {formatDate(p.followUpOn)}</span> : null}
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
