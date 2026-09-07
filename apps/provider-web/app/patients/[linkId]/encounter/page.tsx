"use client";
import { use, useState } from "react";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, ChoiceGrid, TextInput } from "@medpass/ui-web";
import { AwaitingAcceptance } from "../../../../components/AwaitingAcceptance";
import { TextArea } from "../../../../components/TextArea";
import { WorkflowFrame } from "../../../../components/WorkflowFrame";
import { api, newIdempotencyKey } from "../../../../lib/api";
import { dateInputToIso, dateTimeInputToIso, nowInputValue } from "../../../../lib/format";
import { errorMessage } from "../../../../lib/hooks";
import type { ProposalDto } from "../../../../lib/types";

const KINDS = [
  { value: "outpatient", label: "Outpatient visit" },
  { value: "teleconsult", label: "Teleconsultation" },
  { value: "emergency", label: "Emergency" },
  { value: "inpatient", label: "Inpatient" },
  { value: "home", label: "Home visit" },
] as const;
type EncounterKind = (typeof KINDS)[number]["value"];

/** Encounter proposal (docs_v2/06 P11-4): kind, date, summary, follow-up date. */
export default function EncounterPage({ params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = use(params);
  return (
    <WorkflowFrame linkId={linkId} kind="encounter" title="Record a visit">
      {() => <EncounterForm linkId={linkId} />}
    </WorkflowFrame>
  );
}

function EncounterForm({ linkId }: { linkId: string }) {
  const [kind, setKind] = useState<EncounterKind>("outpatient");
  const [startedAt, setStartedAt] = useState(nowInputValue());
  const [practitionerName, setPractitionerName] = useState("");
  const [reason, setReason] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [sent, setSent] = useState<ProposalDto | undefined>();

  const startedIso = dateTimeInputToIso(startedAt);
  const followUpIso = dateInputToIso(followUp);
  const valid = !!startedIso && (!followUp || !!followUpIso);

  async function send() {
    setBusy(true);
    setError(undefined);
    try {
      const proposal = await api.post<ProposalDto>(
        `/provider/patients/${encodeURIComponent(linkId)}/encounters`,
        {
          kind,
          startedAt: startedIso,
          practitionerName: practitionerName.trim() || undefined,
          reasonText: reason.trim() || null,
          diagnosisText: diagnosis.trim() || null,
          notes: notes.trim() || null,
          followUpOn: followUpIso ?? null,
        },
        { idempotencyKey: newIdempotencyKey() },
      );
      setSent(proposal);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <AwaitingAcceptance proposal={sent} linkId={linkId} />;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}
    >
      <ChoiceGrid label="Kind of visit" columns={2} minItemWidth={160} choices={KINDS.map((k) => ({ value: k.value, label: k.label }))} value={kind} onChange={setKind} />
      <TextInput label="Visit date and time" type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} error={startedAt && !startedIso ? "Not a valid date" : undefined} />
      <TextInput label="Doctor seen (optional)" maxLength={120} value={practitionerName} onChange={(e) => setPractitionerName(e.target.value)} />
      <TextInput label="Reason for the visit (optional)" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      <TextInput label="Diagnosis (optional)" maxLength={500} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
      <TextArea label="Summary for the patient (optional)" maxLength={2000} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <TextInput
        label="Follow-up on (optional)"
        type="date"
        help="The patient gets a follow-up reminder once they accept."
        value={followUp}
        onChange={(e) => setFollowUp(e.target.value)}
        error={followUp && !followUpIso ? "Not a valid date" : undefined}
      />
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Button type="submit" loading={busy} disabled={busy || !valid}>
        Send to the patient
      </Button>
    </form>
  );
}
