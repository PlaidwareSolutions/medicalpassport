"use client";
import { use, useState } from "react";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, TextInput } from "@medpass/ui-web";
import { AwaitingAcceptance } from "../../../../components/AwaitingAcceptance";
import { InstructionEditor } from "../../../../components/InstructionEditor";
import { TextArea } from "../../../../components/TextArea";
import { WorkflowFrame } from "../../../../components/WorkflowFrame";
import { api, newIdempotencyKey } from "../../../../lib/api";
import { dateInputToIso, todayInputValue } from "../../../../lib/format";
import { errorMessage } from "../../../../lib/hooks";
import { instructionSummary, validateInstruction, type Instruction } from "../../../../lib/transition";
import type { ProposalDto } from "../../../../lib/types";

interface Item {
  id: string;
  enteredName: string;
  formText: string;
  instruction?: Instruction;
  instructionsText: string;
}

function newItem(): Item {
  return { id: crypto.randomUUID(), enteredName: "", formText: "", instructionsText: "" };
}

/**
 * Prescription capture (docs_v2/06 P11-4): items with name / strength / form
 * / dose / frequency / food / duration / instructions, plus diagnosis,
 * validity and follow-up. Accepted items land in the patient's confirmation
 * queue as `clinic_entered` candidates — never straight onto the list.
 */
export default function PrescriptionPage({ params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = use(params);
  return (
    <WorkflowFrame linkId={linkId} kind="prescription" title="Record a prescription">
      {() => <PrescriptionForm linkId={linkId} />}
    </WorkflowFrame>
  );
}

function PrescriptionForm({ linkId }: { linkId: string }) {
  const [items, setItems] = useState<Item[]>([newItem()]);
  const [practitionerName, setPractitionerName] = useState("");
  const [prescribedAt, setPrescribedAt] = useState(todayInputValue());
  const [diagnosis, setDiagnosis] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState<"edit" | "review" | "sent">("edit");
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [sent, setSent] = useState<ProposalDto | undefined>();

  function update(id: string, patch: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function validate(): string[] {
    const out: string[] = [];
    if (items.length === 0) out.push("Add at least one medicine");
    items.forEach((it, i) => {
      const label = it.enteredName.trim() || `Item ${i + 1}`;
      if (!it.enteredName.trim()) out.push(`Item ${i + 1}: type the medicine name`);
      // The API allows an item with only a name; a dose without a form/frequency is refused here for clarity.
      if (it.instruction) for (const m of validateInstruction(it.instruction)) out.push(`${label}: ${m}`);
    });
    if (!dateInputToIso(prescribedAt)) out.push("Enter the prescription date");
    if (validUntil && !dateInputToIso(validUntil)) out.push("Valid-until date is not valid");
    if (followUp && !dateInputToIso(followUp)) out.push("Follow-up date is not valid");
    return out;
  }

  function body() {
    return {
      practitionerName: practitionerName.trim() || undefined,
      prescribedAt: dateInputToIso(prescribedAt),
      diagnosisText: diagnosis.trim() || null,
      validUntil: dateInputToIso(validUntil) ?? null,
      followUpOn: dateInputToIso(followUp) ?? null,
      notes: notes.trim() || undefined,
      items: items.map((it, i) => ({
        sequence: i + 1,
        enteredName: it.enteredName.trim(),
        strengthLabel: it.instruction?.strengthLabel ?? null,
        formText: it.formText.trim() || null,
        doseQuantity: it.instruction?.doseQuantity ?? null,
        doseUnit: it.instruction?.doseUnit ?? null,
        frequencyCode: it.instruction?.frequencyCode ?? null,
        pattern: it.instruction?.frequencyCode === "PATTERN" ? (it.instruction.pattern ?? null) : null,
        foodInstruction: it.instruction?.foodInstruction ?? null,
        durationDays: it.instruction?.durationDays ?? null,
        instructionsText: it.instructionsText.trim() || null,
      })),
    };
  }

  async function send() {
    setBusy(true);
    setError(undefined);
    try {
      const proposal = await api.post<ProposalDto>(`/provider/patients/${encodeURIComponent(linkId)}/prescriptions`, body(), { idempotencyKey: newIdempotencyKey() });
      setSent(proposal);
      setStep("sent");
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (step === "sent" && sent) return <AwaitingAcceptance proposal={sent} linkId={linkId} />;

  if (step === "review") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
        <h2 style={{ margin: 0, fontSize: "var(--font-large)" }}>Review before sending</h2>
        <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
          {practitionerName.trim() ? `${practitionerName.trim()} · ` : ""}prescribed {prescribedAt}
          {diagnosis.trim() ? ` · ${diagnosis.trim()}` : ""}
          {validUntil ? ` · valid until ${validUntil}` : ""}
          {followUp ? ` · follow-up ${followUp}` : ""}
        </p>
        {items.map((it, i) => (
          <Card key={it.id}>
            <strong>
              {i + 1}. {it.enteredName.trim()}
              {it.instruction?.strengthLabel ? ` ${it.instruction.strengthLabel}` : ""}
              {it.formText.trim() ? ` (${it.formText.trim()})` : ""}
            </strong>
            <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{it.instruction ? instructionSummary(it.instruction) : "No dose recorded"}</span>
            {it.instructionsText.trim() ? <span style={{ fontSize: "var(--font-small)" }}>{it.instructionsText.trim()}</span> : null}
          </Card>
        ))}
        {notes.trim() ? <p style={{ margin: 0, fontSize: "var(--font-small)" }}>Notes: {notes.trim()}</p> : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
          <Button variant="secondary" onClick={() => setStep("edit")} disabled={busy}>
            Back to edit
          </Button>
          <Button onClick={() => void send()} loading={busy} disabled={busy}>
            Send to the patient
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-md)" }}>
        <TextInput label="Prescribing doctor (optional)" maxLength={120} value={practitionerName} onChange={(e) => setPractitionerName(e.target.value)} />
        <TextInput label="Prescribed on" type="date" value={prescribedAt} onChange={(e) => setPrescribedAt(e.target.value)} />
      </div>
      <TextInput label="Diagnosis (optional)" maxLength={500} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-md)" }}>
        <TextInput label="Valid until (optional)" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        <TextInput label="Follow-up on (optional)" type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
      </div>

      <section aria-labelledby="items-heading" style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
        <h2 id="items-heading" style={{ fontSize: "var(--font-large)", margin: 0 }}>
          Medicines
        </h2>
        {items.map((it, i) => {
          const label = it.enteredName.trim() || `Item ${i + 1}`;
          return (
            <Card key={it.id}>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                <TextInput label={`Medicine name (item ${i + 1})`} placeholder="As written on the prescription" maxLength={200} value={it.enteredName} onChange={(e) => update(it.id, { enteredName: e.target.value })} />
                <TextInput label={`${label}: form as written (optional)`} placeholder="e.g. tablet, syrup" maxLength={60} value={it.formText} onChange={(e) => update(it.id, { formText: e.target.value })} />
                <InstructionEditor namePrefix={label} value={it.instruction} onChange={(instruction) => update(it.id, { instruction })} />
                <TextInput label={`${label}: instructions (optional)`} maxLength={500} value={it.instructionsText} onChange={(e) => update(it.id, { instructionsText: e.target.value })} />
                {items.length > 1 ? (
                  <Button variant="ghost" onClick={() => setItems((prev) => prev.filter((x) => x.id !== it.id))}>
                    Remove {label}
                  </Button>
                ) : null}
              </div>
            </Card>
          );
        })}
        <Button variant="secondary" onClick={() => setItems((prev) => (prev.length < 30 ? [...prev, newItem()] : prev))} disabled={items.length >= 30}>
          Add another medicine
        </Button>
      </section>
      <TextArea label="Notes (optional)" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {issues.length > 0 ? (
        <Banner tone="danger">
          <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
            {issues.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
      <Button
        onClick={() => {
          const problems = validate();
          setIssues(problems);
          if (problems.length === 0) setStep("review");
        }}
      >
        Review before sending
      </Button>
    </div>
  );
}
