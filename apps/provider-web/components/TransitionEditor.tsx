"use client";
import { useMemo, useState, type ReactNode } from "react";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, ChoiceGrid, TextInput } from "@medpass/ui-web";
import { api, newIdempotencyKey } from "../lib/api";
import { errorMessage } from "../lib/hooks";
import {
  EXISTING_DECISIONS,
  instructionSummary,
  lineKey,
  splitForReview,
  stopLinesCarryNoInstruction,
  toPayloadLines,
  validateTransition,
  type EditorLine,
  type ExistingLine,
  type Instruction,
  type NewLine,
  type TransitionMode,
} from "../lib/transition";
import type { ProposalDto, SnapshotMedication } from "../lib/types";
import { AwaitingAcceptance } from "./AwaitingAcceptance";
import { InstructionEditor } from "./InstructionEditor";

const DECISION_LABELS: Record<(typeof EXISTING_DECISIONS)[number], string> = { CONTINUE: "Continue", CHANGE: "Change", STOP: "Stop" };
const DECISION_HELP: Record<(typeof EXISTING_DECISIONS)[number], string> = {
  CONTINUE: "Keep taking it as now",
  CHANGE: "New dose or schedule",
  STOP: "Stop taking it",
};

function initialLines(medications: readonly SnapshotMedication[]): EditorLine[] {
  return medications
    .filter((m): m is SnapshotMedication & { patientMedicationId: string } => typeof m.patientMedicationId === "string")
    .map((m) => ({
      kind: "existing",
      medicine: { patientMedicationId: m.patientMedicationId, name: m.name, strengthLabel: m.strengthLabel, instructionSummary: m.instructionSummary },
    }));
}

/**
 * The reconciliation (clinic) / discharge transition (hospital) editor:
 * one line per current medicine with CONTINUE / CHANGE / STOP, new
 * medicines added with the typing-free instruction pickers, STOP lines
 * kept visibly apart, a review step before anything is sent, and the
 * "awaiting acceptance" state after. `mode: "discharge"` enforces H-34
 * (every current medicine decided) through lib/transition.ts.
 */
export function TransitionEditor({
  mode,
  linkId,
  medications,
  medicationsShared,
  apiSegment,
  headerFields,
  validateHeader,
  headerPayload,
  reviewHeader,
}: {
  mode: TransitionMode;
  linkId: string;
  medications: readonly SnapshotMedication[];
  /** False when the link does not grant the medications section — the editor can only add new medicines then. */
  medicationsShared: boolean;
  apiSegment: "reconciliations" | "discharge";
  /** Extra inputs above the lines (discharge dates, notes, practitioner). */
  headerFields?: ReactNode;
  validateHeader?: () => string[];
  headerPayload?: () => Record<string, unknown>;
  reviewHeader?: ReactNode;
}) {
  const [lines, setLines] = useState<EditorLine[]>(() => initialLines(medications));
  const [step, setStep] = useState<"edit" | "review" | "sent">("edit");
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | undefined>();
  const [sent, setSent] = useState<ProposalDto | undefined>();

  const issueByLine = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const issue of validateTransition(lines, mode)) {
      if (!issue.lineKey) continue;
      map.set(issue.lineKey, [...(map.get(issue.lineKey) ?? []), issue.message]);
    }
    return map;
  }, [lines, mode]);

  function updateLine(key: string, patch: (line: EditorLine) => EditorLine) {
    setLines((prev) => prev.map((l) => (lineKey(l) === key ? patch(l) : l)));
  }

  function addNewLine() {
    setLines((prev) => [...prev, { kind: "new", id: `new-${crypto.randomUUID()}`, name: "" }]);
  }

  function removeNewLine(key: string) {
    setLines((prev) => prev.filter((l) => lineKey(l) !== key));
  }

  function goToReview() {
    const problems = [...validateTransition(lines, mode).map((i) => i.message), ...(validateHeader?.() ?? [])];
    setIssues(problems);
    if (problems.length === 0) setStep("review");
  }

  async function send() {
    setBusy(true);
    setSendError(undefined);
    try {
      const payloadLines = toPayloadLines(lines);
      if (!stopLinesCarryNoInstruction(payloadLines)) throw new Error("A stopped medicine would carry an instruction (H-34)");
      const body = { ...(headerPayload?.() ?? {}), lines: payloadLines };
      const proposal = await api.post<ProposalDto>(`/provider/patients/${encodeURIComponent(linkId)}/${apiSegment}`, body, { idempotencyKey: newIdempotencyKey() });
      setSent(proposal);
      setStep("sent");
    } catch (err) {
      setSendError(err instanceof ApiError ? err.problem.title || errorMessage(err) : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (step === "sent" && sent) return <AwaitingAcceptance proposal={sent} linkId={linkId} />;

  if (step === "review") {
    const { active, stopped, undecided } = splitForReview(lines);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }} data-testid="transition-review">
        <h2 style={{ margin: 0, fontSize: "var(--font-large)" }}>Review before sending</h2>
        <Banner tone="info">This is the patient's own record. They decide what to accept — nothing changes until they do.</Banner>
        {reviewHeader}
        <section aria-labelledby="review-active">
          <h3 id="review-active" style={{ fontSize: "var(--font-body)", margin: "0 0 var(--space-sm)" }}>
            Will be taking
          </h3>
          {active.length === 0 ? <p style={{ color: "var(--color-text-muted)", margin: 0 }}>No medicine continues or starts.</p> : null}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {active.map((line) => (
              <Card key={lineKey(line)}>
                <strong>{line.kind === "new" ? line.name : line.medicine.name}</strong>
                <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {line.kind === "new"
                    ? `START · ${instructionSummary(line.instruction)}`
                    : line.decision === "CHANGE"
                      ? `CHANGE · ${instructionSummary(line.instruction)} (was ${line.medicine.instructionSummary || "unspecified"})`
                      : `CONTINUE · ${line.medicine.instructionSummary || "as now"}`}
                </span>
                {line.reasonText ? <span style={{ fontSize: "var(--font-small)" }}>Reason: {line.reasonText}</span> : null}
              </Card>
            ))}
          </div>
        </section>
        <section aria-labelledby="review-stopped" data-testid="review-stopped">
          <h3 id="review-stopped" style={{ fontSize: "var(--font-body)", margin: "0 0 var(--space-sm)", color: "var(--color-danger)" }}>
            Will stop
          </h3>
          {stopped.length === 0 ? <p style={{ color: "var(--color-text-muted)", margin: 0 }}>Nothing stops.</p> : null}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {stopped.map((line) =>
              line.kind === "existing" ? (
                <Card key={lineKey(line)} tone="danger">
                  <strong>STOP · {line.medicine.name}</strong>
                  <span style={{ fontSize: "var(--font-small)" }}>{line.reasonText ? `Reason: ${line.reasonText}` : "No reason given"}</span>
                  <span style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>Leaves the patient's current list once they accept this line.</span>
                </Card>
              ) : null,
            )}
          </div>
        </section>
        {undecided.length > 0 ? (
          <section aria-labelledby="review-undecided">
            <h3 id="review-undecided" style={{ fontSize: "var(--font-body)", margin: "0 0 var(--space-sm)" }}>
              Not discussed — unchanged
            </h3>
            <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
              {undecided.map((l) => (l.kind === "existing" ? l.medicine.name : l.name)).join(", ")}
            </p>
          </section>
        ) : null}
        {sendError ? <Banner tone="danger">{sendError}</Banner> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
          <Button variant="secondary" onClick={() => setStep("edit")} disabled={busy}>
            Back to edit
          </Button>
          <Button onClick={() => void send()} loading={busy} disabled={busy} data-testid="send-proposal">
            Send to the patient
          </Button>
        </div>
      </div>
    );
  }

  const existing = lines.filter((l): l is ExistingLine => l.kind === "existing");
  const added = lines.filter((l): l is NewLine => l.kind === "new");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      {headerFields}
      <section aria-labelledby="current-medicines">
        <h2 id="current-medicines" style={{ fontSize: "var(--font-large)", margin: "0 0 var(--space-sm)" }}>
          Current medicines
        </h2>
        {!medicationsShared ? (
          <Banner tone="warning">The patient did not share their medicine list with this link, so only new medicines can be proposed here.</Banner>
        ) : existing.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)" }}>The patient has no current medicines on record.</p>
        ) : null}
        {mode === "discharge" && existing.length > 0 ? (
          <Banner tone="info">Every current medicine needs a decision before discharge. A stopped medicine never stays on the list.</Banner>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)", marginTop: "var(--space-sm)" }}>
          {existing.map((line) => {
            const key = lineKey(line);
            const lineIssues = issueByLine.get(key) ?? [];
            return (
              <Card key={key} tone={line.decision === "STOP" ? "danger" : "default"} data-testid={`line-${key}`}>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                  <div>
                    <strong>{line.medicine.name}</strong>
                    {line.medicine.strengthLabel ? <span style={{ marginLeft: "var(--space-xs)" }}>{line.medicine.strengthLabel}</span> : null}
                    <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>Now: {line.medicine.instructionSummary || "no instruction recorded"}</div>
                  </div>
                  <ChoiceGrid
                    label={`Decision: ${line.medicine.name}`}
                    columns={3}
                    choices={EXISTING_DECISIONS.map((d) => ({ value: d, label: DECISION_LABELS[d], description: DECISION_HELP[d] }))}
                    value={line.decision}
                    onChange={(decision) =>
                      updateLine(key, (l) => (l.kind === "existing" ? { ...l, decision, instruction: decision === "CHANGE" ? l.instruction : undefined } : l))
                    }
                  />
                  {line.decision === "CHANGE" ? (
                    <InstructionEditor
                      namePrefix={line.medicine.name}
                      value={line.instruction}
                      onChange={(instruction: Instruction | undefined) => updateLine(key, (l) => (l.kind === "existing" ? { ...l, instruction } : l))}
                    />
                  ) : null}
                  {line.decision === "STOP" ? (
                    <TextInput
                      label={`Why stop ${line.medicine.name} (optional)`}
                      maxLength={500}
                      value={line.reasonText ?? ""}
                      onChange={(e) => updateLine(key, (l) => ({ ...l, reasonText: e.target.value }))}
                    />
                  ) : null}
                  {lineIssues.length > 0 && line.decision ? (
                    <span style={{ color: "var(--color-danger)", fontSize: "var(--font-small)" }}>{lineIssues.join(" · ")}</span>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="new-medicines">
        <h2 id="new-medicines" style={{ fontSize: "var(--font-large)", margin: "0 0 var(--space-sm)" }}>
          New medicines
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          {added.map((line, index) => {
            const key = lineKey(line);
            const label = line.name.trim() || `New medicine ${index + 1}`;
            return (
              <Card key={key} data-testid={`new-line-${index + 1}`}>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                  <TextInput
                    label={`Medicine name (new medicine ${index + 1})`}
                    placeholder="Brand or generic name as written"
                    maxLength={200}
                    value={line.name}
                    onChange={(e) => updateLine(key, (l) => (l.kind === "new" ? { ...l, name: e.target.value } : l))}
                  />
                  <InstructionEditor
                    namePrefix={label}
                    value={line.instruction}
                    onChange={(instruction: Instruction | undefined) => updateLine(key, (l) => (l.kind === "new" ? { ...l, instruction } : l))}
                  />
                  <TextInput
                    label={`Reason for starting ${label} (optional)`}
                    maxLength={500}
                    value={line.reasonText ?? ""}
                    onChange={(e) => updateLine(key, (l) => ({ ...l, reasonText: e.target.value }))}
                  />
                  <Button variant="ghost" onClick={() => removeNewLine(key)}>
                    Remove {label}
                  </Button>
                </div>
              </Card>
            );
          })}
          <Button variant="secondary" onClick={addNewLine} data-testid="add-medicine">
            Add a medicine
          </Button>
        </div>
      </section>

      {issues.length > 0 ? (
        <Banner tone="danger">
          <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
            {issues.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
      <Button onClick={goToReview} data-testid="review-proposal">
        Review before sending
      </Button>
    </div>
  );
}
