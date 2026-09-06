"use client";
import { use, useState } from "react";
import { TextInput } from "@medpass/ui-web";
import { TextArea } from "../../../../components/TextArea";
import { TransitionEditor } from "../../../../components/TransitionEditor";
import { WorkflowFrame } from "../../../../components/WorkflowFrame";
import { dateInputToIso, dateTimeInputToIso, nowInputValue } from "../../../../lib/format";

/**
 * Hospital discharge transition (docs_v2/06 P14, hazard H-34): every current
 * medicine gets an explicit START/CONTINUE/CHANGE/STOP decision (enforced by
 * the editor in discharge mode), STOP lines never become current, plus test
 * requirements and follow-up. The API body has no dedicated field for test
 * requirements, so they travel in `summaryText` under their own heading.
 */
export default function DischargePage({ params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = use(params);
  const [admittedAt, setAdmittedAt] = useState("");
  const [dischargedAt, setDischargedAt] = useState(nowInputValue());
  const [diagnosis, setDiagnosis] = useState("");
  const [summary, setSummary] = useState("");
  const [tests, setTests] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [practitionerName, setPractitionerName] = useState("");

  function composedSummary(): string | null {
    const parts: string[] = [];
    if (summary.trim()) parts.push(summary.trim());
    if (tests.trim()) parts.push(`Tests required after discharge:\n${tests.trim()}`);
    const text = parts.join("\n\n");
    return text ? text.slice(0, 4000) : null;
  }

  function validateHeader(): string[] {
    const issues: string[] = [];
    const admitted = dateTimeInputToIso(admittedAt);
    const discharged = dateTimeInputToIso(dischargedAt);
    if (!admitted) issues.push("Enter the admission date and time");
    if (!discharged) issues.push("Enter the discharge date and time");
    if (admitted && discharged && admitted > discharged) issues.push("Discharge cannot be before admission");
    if (followUp && !dateInputToIso(followUp)) issues.push("Follow-up date is not valid");
    return issues;
  }

  return (
    <WorkflowFrame linkId={linkId} kind="discharge_transition" title="Discharge transition">
      {(snapshot) => (
        <TransitionEditor
          mode="discharge"
          linkId={linkId}
          apiSegment="discharge"
          medications={snapshot.currentMedications ?? []}
          medicationsShared={snapshot.sections.includes("medications")}
          headerFields={
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-md)" }}>
                <TextInput label="Admitted on" type="datetime-local" value={admittedAt} onChange={(e) => setAdmittedAt(e.target.value)} />
                <TextInput label="Discharged on" type="datetime-local" value={dischargedAt} onChange={(e) => setDischargedAt(e.target.value)} />
              </div>
              <TextInput label="Discharge diagnosis (optional)" maxLength={500} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
              <TextArea label="Discharge summary (optional)" maxLength={3000} rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />
              <TextArea
                label="Tests required after discharge (optional)"
                help="One per line, with when: e.g. HbA1c in 3 months"
                maxLength={800}
                value={tests}
                onChange={(e) => setTests(e.target.value)}
              />
              <TextInput label="Follow-up on (optional)" type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
              <TextInput label="Discharging doctor (optional)" maxLength={120} value={practitionerName} onChange={(e) => setPractitionerName(e.target.value)} />
            </div>
          }
          validateHeader={validateHeader}
          headerPayload={() => ({
            admittedAt: dateTimeInputToIso(admittedAt),
            dischargedAt: dateTimeInputToIso(dischargedAt),
            diagnosisText: diagnosis.trim() || null,
            summaryText: composedSummary(),
            followUpOn: dateInputToIso(followUp) ?? null,
            ...(practitionerName.trim() ? { practitionerName: practitionerName.trim() } : {}),
          })}
          reviewHeader={
            <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)", whiteSpace: "pre-wrap" }}>
              {diagnosis.trim() ? `Diagnosis: ${diagnosis.trim()}\n` : ""}
              {composedSummary() ?? ""}
              {followUp ? `\nFollow-up on ${followUp}` : ""}
            </div>
          }
        />
      )}
    </WorkflowFrame>
  );
}
