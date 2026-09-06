"use client";
import { use, useState } from "react";
import { TextInput } from "@medpass/ui-web";
import { TextArea } from "../../../../components/TextArea";
import { TransitionEditor } from "../../../../components/TransitionEditor";
import { WorkflowFrame } from "../../../../components/WorkflowFrame";

/** Clinic reconciliation proposal (docs_v2/06 P11-4): snapshot → lines → review → awaiting acceptance. */
export default function ReconciliationPage({ params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = use(params);
  const [practitionerName, setPractitionerName] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <WorkflowFrame linkId={linkId} kind="reconciliation" title="Reconcile medicines">
      {(snapshot) => (
        <TransitionEditor
          mode="reconciliation"
          linkId={linkId}
          apiSegment="reconciliations"
          medications={snapshot.currentMedications ?? []}
          medicationsShared={snapshot.sections.includes("medications")}
          headerFields={
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
              <TextInput label="Reviewing doctor (optional)" maxLength={120} value={practitionerName} onChange={(e) => setPractitionerName(e.target.value)} />
              <TextArea label="Notes for the patient (optional)" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          }
          headerPayload={() => ({
            ...(practitionerName.trim() ? { practitionerName: practitionerName.trim() } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          })}
          reviewHeader={
            practitionerName.trim() || notes.trim() ? (
              <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                {practitionerName.trim() ? `Reviewed by ${practitionerName.trim()}. ` : ""}
                {notes.trim() ? `Notes: ${notes.trim()}` : ""}
              </p>
            ) : undefined
          }
        />
      )}
    </WorkflowFrame>
  );
}
