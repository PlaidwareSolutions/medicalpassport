"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ApiError, type PatientMedicationDto } from "@medpass/api-client";
import { pluralKey, type MessageKey } from "@medpass/localization";
import { formatDoseAmount } from "@medpass/medication-terminology";
import { Banner, Button, Card, Chip, PillSpinner, SectionTitle, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { GuideGlyph, type GuideGlyphName } from "../../../components/GuideGlyph";
import { PageHeader } from "../../../components/PageHeader";
import { isStepUpRequired } from "../../../lib/api";
import { organizationKindLabelKey } from "../../../lib/connections";
import { useI18n } from "../../../lib/i18n";
import { useMedications } from "../../../lib/medications";
import { formatPatientDate, useActiveTimezone } from "../../../lib/patient-time";
import {
  LINE_DECISIONS,
  acceptProposal,
  decisionBodyKey,
  decisionTitleKey,
  kindLabelKey,
  proposalLines,
  rejectProposal,
  resultHref,
  resultLabelKey,
  useProposal,
  type DiagnosticReportPayload,
  type DischargePayload,
  type DispensePayload,
  type EncounterPayload,
  type LineDecision,
  type PrescriptionPayload,
  type ProposalDto,
  type ProposalLine,
  type ProposedInstruction,
} from "../../../lib/proposals";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Each transition group gets its own look, so a STOP can never be mistaken for an add (H-34). */
const GROUP_STYLE: Record<LineDecision, { tone: "default" | "info" | "warning" | "danger"; glyph: GuideGlyphName }> = {
  START: { tone: "info", glyph: "tablet" },
  CONTINUE: { tone: "default", glyph: "check" },
  CHANGE: { tone: "warning", glyph: "prescription" },
  STOP: { tone: "danger", glyph: "cross" },
};

/**
 * One proposal in full (docs_v2/06 P11-5, P14).
 *
 * For a reconciliation or a discharge the four decisions are four visually
 * distinct groups in plain language — keep taking, start, change, stop —
 * and every line carries its own yes/no (H-43), sent as `declinedLines` on
 * accept. Two rules this screen exists to keep (H-34): a STOP line is never
 * drawn as something being added — it shows no dose, sits in its own
 * danger-toned group, and says the medicine would be stopped — and the
 * whole transition is never reduced to a single yes/no while its lines can
 * be declined individually.
 *
 * Nothing here writes anything: the accept call is the only path into the
 * record, and it is step-up guarded.
 */
export default function ProposalDetailPage() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { proposal, error, reload } = useProposal(id);
  const { items: medications } = useMedications();

  const [declined, setDeclined] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState<string | undefined>();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [accepted, setAccepted] = useState<ProposalDto | undefined>();

  const lines = useMemo(() => (proposal ? proposalLines(proposal) : []), [proposal]);
  const hasLines = lines.length > 0;
  const declinedIndexes = useMemo(() => lines.map((_, i) => i).filter((i) => declined[i]), [lines, declined]);
  const acceptedCount = lines.length - declinedIndexes.length;
  const allDeclined = hasLines && acceptedCount === 0;

  const medicationName = (line: ProposalLine): string => {
    if (line.proposedName) return line.proposedName;
    const found = (medications ?? []).find((m: PatientMedicationDto) => m.id === line.patientMedicationId);
    return found?.enteredName ?? t("proposals.line.unknown_medicine");
  };

  async function accept() {
    if (!proposal || allDeclined) return;
    setBusy(true);
    setDecisionError(undefined);
    try {
      setAccepted(await acceptProposal(proposal.id, declinedIndexes));
      await reload();
    } catch (err) {
      setDecisionError(decisionErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!proposal) return;
    setBusy(true);
    setDecisionError(undefined);
    try {
      await rejectProposal(proposal.id, reason);
      setRejecting(false);
      await reload();
    } catch (err) {
      setDecisionError(decisionErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <AppShell>
        <PageHeader title={t("proposals.detail_title")} />
        <Banner tone="danger">{t("common.error_generic")}</Banner>
        <Link href="/proposals">
          <Button variant="secondary" fullWidth>
            {t("proposals.back_to_list")}
          </Button>
        </Link>
      </AppShell>
    );
  }

  if (!proposal) {
    return (
      <AppShell>
        <PageHeader title={t("proposals.detail_title")} />
        <PillSpinner label={t("common.loading")} />
      </AppShell>
    );
  }

  const decided = proposal.status !== "proposed";
  const result = accepted ?? (proposal.status === "accepted" ? proposal : undefined);

  return (
    <AppShell>
      <PageHeader
        title={t(kindLabelKey(proposal.kind))}
        readAloud={[{ text: `${t(kindLabelKey(proposal.kind))}. ${t("proposals.nothing_changed_yet")}` }]}
        right={<Chip tone={proposal.status === "accepted" ? "success" : proposal.status === "proposed" ? "warning" : "default"}>{t(`proposals.status.${proposal.status}` as MessageKey)}</Chip>}
      />

      <Card tone="info" data-testid="proposal-source">
        <strong style={{ overflowWrap: "anywhere" }}>{proposal.organization.displayName}</strong>
        <Chip>{t(organizationKindLabelKey(proposal.organization.kind))}</Chip>
        <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
          {t("proposals.sent_on", { date: formatPatientDate(proposal.proposedAt, timezone) })}
        </span>
        {!decided ? <span>{t("proposals.nothing_changed_yet")}</span> : null}
      </Card>

      {decisionError ? <Banner tone="danger">{decisionError}</Banner> : null}

      {result ? (
        <Card tone="info" data-testid="proposal-accepted">
          <strong>{t("proposals.accepted_title")}</strong>
          <span>{t("proposals.accepted_body")}</span>
          {resultHref(result.resultingEntityType, result.resultingEntityId) ? (
            <Link href={resultHref(result.resultingEntityType, result.resultingEntityId)!} data-testid="proposal-result-link">
              <Button variant="secondary" fullWidth>
                {t(resultLabelKey(result.resultingEntityType))}
              </Button>
            </Link>
          ) : null}
        </Card>
      ) : null}

      {proposal.status === "rejected" ? <Banner tone="warning">{t("proposals.rejected_body")}</Banner> : null}
      {proposal.status === "withdrawn" || proposal.status === "expired" ? <Banner tone="warning">{t("proposals.closed_body")}</Banner> : null}

      <ProposalBody proposal={proposal} t={t} timezone={timezone} />

      {hasLines ? (
        <>
          <p style={{ margin: "var(--space-md) 0 0" }}>{decided ? t("proposals.lines_intro_decided") : t("proposals.lines_intro")}</p>
          {LINE_DECISIONS.map((decision) => {
            const group = lines.map((line, index) => ({ line, index })).filter((x) => x.line.decision === decision);
            if (group.length === 0) return null;
            const style = GROUP_STYLE[decision];
            return (
              <section key={decision} aria-label={t(decisionTitleKey(decision))} data-testid="decision-group" data-decision={decision}>
                <SectionTitle>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-xs)" }}>
                    <GuideGlyph name={style.glyph} size="sm" />
                    {t(decisionTitleKey(decision))}
                  </span>
                </SectionTitle>
                <p style={{ margin: "0 0 var(--space-sm)", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t(decisionBodyKey(decision))}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                  {group.map(({ line, index }) => (
                    <LineCard
                      key={index}
                      line={line}
                      name={medicationName(line)}
                      tone={style.tone}
                      declined={!!declined[index]}
                      decided={decided}
                      busy={busy}
                      t={t}
                      onDecline={(value) => setDeclined((prev) => ({ ...prev, [index]: value }))}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      ) : null}

      {!decided ? (
        <div style={{ marginTop: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {hasLines ? (
            <Card>
              <strong>{t("proposals.accept_count", { accepted: acceptedCount, total: lines.length })}</strong>
              {declinedIndexes.length > 0 ? <span>{t("proposals.declined_count", { n: declinedIndexes.length })}</span> : null}
              {allDeclined ? <span style={{ color: "var(--color-danger)" }}>{t("proposals.all_declined_hint")}</span> : null}
            </Card>
          ) : null}

          <Button fullWidth loading={busy} disabled={busy || allDeclined} onClick={() => void accept()} data-testid="accept-proposal">
            {hasLines ? t("proposals.accept_lines", { n: acceptedCount }) : t("proposals.accept")}
          </Button>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("proposals.accept_hint")}</span>

          {rejecting ? (
            <Card tone="warning">
              <strong>{t("proposals.reject_title")}</strong>
              <span>{t("proposals.reject_body")}</span>
              <TextInput
                label={t("proposals.reject_reason_label")}
                help={t("proposals.reject_reason_help")}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button fullWidth loading={busy} disabled={busy} onClick={() => void reject()} data-testid="confirm-reject">
                {t("proposals.reject_confirm")}
              </Button>
              <Button variant="ghost" fullWidth disabled={busy} onClick={() => setRejecting(false)}>
                {t("common.cancel")}
              </Button>
            </Card>
          ) : (
            <Button variant="secondary" fullWidth disabled={busy} onClick={() => setRejecting(true)} data-testid="reject-proposal">
              {t("proposals.reject")}
            </Button>
          )}
        </div>
      ) : null}

      <div style={{ marginTop: "var(--space-lg)" }}>
        <Link href="/proposals">
          <Button variant="ghost" fullWidth>
            {t("proposals.back_to_list")}
          </Button>
        </Link>
      </div>
    </AppShell>
  );
}

/**
 * One transition line. A STOP line shows the medicine and the reason and
 * nothing that looks like an instruction to take it (H-34); every line,
 * whatever its decision, carries its own yes/no (H-43).
 */
function LineCard({
  line,
  name,
  tone,
  declined,
  decided,
  busy,
  t,
  onDecline,
}: {
  line: ProposalLine;
  name: string;
  tone: "default" | "info" | "warning" | "danger";
  declined: boolean;
  decided: boolean;
  busy: boolean;
  t: Translate;
  onDecline: (declined: boolean) => void;
}) {
  const showInstruction = line.decision !== "STOP" && !!line.proposedInstruction;
  return (
    <Card tone={tone} data-testid="proposal-line" data-decision={line.decision} data-declined={declined ? "true" : "false"} style={declined ? { opacity: 0.7 } : undefined}>
      <strong style={{ fontSize: "var(--font-large)", overflowWrap: "anywhere" }}>{name}</strong>
      <span>{t(`proposals.line.${line.decision.toLowerCase()}_says` as MessageKey, { name })}</span>
      {showInstruction ? (
        <span style={{ color: "var(--color-text-muted)" }} data-testid="proposal-line-instruction">
          {instructionText(line.proposedInstruction!, t)}
        </span>
      ) : null}
      {line.reasonText ? <span style={{ overflowWrap: "anywhere" }}>{t("proposals.line.reason", { reason: line.reasonText })}</span> : null}

      {decided ? null : (
        <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
          <Button variant={declined ? "secondary" : "primary"} aria-pressed={!declined} disabled={busy} onClick={() => onDecline(false)} style={{ flex: "1 1 auto" }}>
            {t("proposals.line.yes")}
          </Button>
          <Button
            variant={declined ? "primary" : "secondary"}
            aria-pressed={declined}
            disabled={busy}
            onClick={() => onDecline(true)}
            style={{ flex: "1 1 auto" }}
            data-testid="decline-line"
          >
            {t("proposals.line.no")}
          </Button>
        </div>
      )}
      {declined ? <Chip tone="warning">{t("proposals.line.declined_chip")}</Chip> : null}
    </Card>
  );
}

/** The kind-specific detail above the lines (or instead of them). */
function ProposalBody({ proposal, t, timezone }: { proposal: ProposalDto; t: Translate; timezone: string }) {
  switch (proposal.kind) {
    case "discharge_transition": {
      const payload = proposal.payload as DischargePayload;
      return (
        <Card>
          <strong>{t("proposals.discharge_title")}</strong>
          <span>{t("proposals.discharge_dates", { from: formatPatientDate(payload.admittedAt, timezone), to: formatPatientDate(payload.dischargedAt, timezone) })}</span>
          {payload.diagnosisText ? <span style={{ overflowWrap: "anywhere" }}>{t("proposals.field.diagnosis", { text: payload.diagnosisText })}</span> : null}
          {payload.summaryText ? <span style={{ overflowWrap: "anywhere" }}>{payload.summaryText}</span> : null}
          {payload.followUpOn ? <Chip tone="warning">{t("proposals.follow_up", { date: formatPatientDate(payload.followUpOn, timezone) })}</Chip> : null}
        </Card>
      );
    }
    case "reconciliation": {
      const payload = proposal.payload as { notes?: string | null; practitionerName?: string };
      if (!payload?.notes && !payload?.practitionerName) return null;
      return (
        <Card>
          {payload.practitionerName ? <span>{t("proposals.field.doctor", { name: payload.practitionerName })}</span> : null}
          {payload.notes ? <span style={{ overflowWrap: "anywhere" }}>{payload.notes}</span> : null}
        </Card>
      );
    }
    case "prescription": {
      const payload = proposal.payload as PrescriptionPayload;
      return (
        <>
          <SectionTitle>{t("proposals.prescription_items")}</SectionTitle>
          <Card>
            {payload.practitionerName ? <span>{t("proposals.field.doctor", { name: payload.practitionerName })}</span> : null}
            {payload.prescribedAt ? <span>{t("proposals.field.written_on", { date: formatPatientDate(payload.prescribedAt, timezone) })}</span> : null}
            {payload.diagnosisText ? <span style={{ overflowWrap: "anywhere" }}>{t("proposals.field.diagnosis", { text: payload.diagnosisText })}</span> : null}
          </Card>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
            {(payload.items ?? []).map((item, i) => (
              <Card key={i} data-testid="prescription-item">
                <strong style={{ overflowWrap: "anywhere" }}>
                  {item.enteredName}
                  {item.strengthLabel ? ` ${item.strengthLabel}` : ""}
                </strong>
                {item.text ? <span style={{ color: "var(--color-text-muted)", overflowWrap: "anywhere" }}>{item.text}</span> : null}
              </Card>
            ))}
          </div>
        </>
      );
    }
    case "encounter": {
      const payload = proposal.payload as EncounterPayload;
      return (
        <Card>
          <strong>{t(`documents.encounter_kind.${payload.kind}` as MessageKey)}</strong>
          <span>{t("proposals.field.visit_on", { date: formatPatientDate(payload.startedAt, timezone) })}</span>
          {payload.practitionerName ? <span>{t("proposals.field.doctor", { name: payload.practitionerName })}</span> : null}
          {payload.reasonText ? <span style={{ overflowWrap: "anywhere" }}>{t("proposals.field.reason", { text: payload.reasonText })}</span> : null}
          {payload.diagnosisText ? <span style={{ overflowWrap: "anywhere" }}>{t("proposals.field.diagnosis", { text: payload.diagnosisText })}</span> : null}
          {payload.followUpOn ? <Chip tone="warning">{t("proposals.follow_up", { date: formatPatientDate(payload.followUpOn, timezone) })}</Chip> : null}
        </Card>
      );
    }
    case "dispense": {
      const payload = proposal.payload as DispensePayload;
      return (
        <Card>
          <strong style={{ overflowWrap: "anywhere" }}>{payload.medicineName}</strong>
          <span>{t("proposals.dispense_quantity", { quantity: payload.quantity, unit: payload.unit })}</span>
          <span>{t("proposals.dispense_on", { date: formatPatientDate(payload.dispensedAt, timezone) })}</span>
          {payload.daysSupply ? <span>{t(pluralKey(payload.daysSupply, "proposals.dispense_days_one", "proposals.dispense_days"), { n: payload.daysSupply })}</span> : null}
        </Card>
      );
    }
    case "diagnostic_report": {
      const payload = proposal.payload as DiagnosticReportPayload;
      return (
        <>
          <Card>
            <strong style={{ overflowWrap: "anywhere" }}>{payload.title}</strong>
            {payload.testedAt ? <span>{t("proposals.field.tested_on", { date: formatPatientDate(payload.testedAt, timezone) })}</span> : null}
          </Card>
          {(payload.results ?? []).length > 0 ? (
            <>
              <SectionTitle>{t("proposals.report_results")}</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {payload.results.map((r, i) => (
                  <Card key={i} data-testid="report-result">
                    <strong style={{ overflowWrap: "anywhere" }}>{r.analyteLabelText ?? ""}</strong>
                    <span>
                      {r.enteredValueText ?? ""} {r.enteredUnit ?? ""}
                    </span>
                    {r.referenceText ? <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{r.referenceText}</span> : null}
                  </Card>
                ))}
              </div>
            </>
          ) : null}
        </>
      );
    }
    default:
      return null;
  }
}

/** Dose, how often, and with food — the same three facts the medicine screens show. */
function instructionText(i: ProposedInstruction, t: Translate): string {
  const freq = i.pattern ? i.pattern : t(`frequency.${String(i.frequencyCode).toLowerCase()}` as MessageKey);
  const unit = t(`unit.${i.doseUnit}` as MessageKey);
  const parts = [`${formatDoseAmount(Number(i.doseQuantity))} ${unit}`, freq];
  if (i.foodInstruction) parts.push(t(`food.${i.foodInstruction}` as MessageKey));
  if (i.durationDays) parts.push(t(pluralKey(i.durationDays, "proposals.for_days_one", "proposals.for_days"), { n: i.durationDays }));
  return parts.join(" · ");
}

function decisionErrorText(err: unknown, t: Translate): string {
  // A cancelled "Confirm it's you" surfaces as the original 403: say that
  // nothing changed rather than "something went wrong".
  if (isStepUpRequired(err)) return t("stepup.not_confirmed");
  if (err instanceof ApiError) return err.problem.errors?.[0]?.message ?? err.problem.title;
  return t("common.error_generic");
}
