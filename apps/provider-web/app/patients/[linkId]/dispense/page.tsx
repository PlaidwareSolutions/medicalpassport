"use client";
import { use, useState } from "react";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, ChoiceGrid, TextInput } from "@medpass/ui-web";
import { AwaitingAcceptance } from "../../../../components/AwaitingAcceptance";
import { WorkflowFrame } from "../../../../components/WorkflowFrame";
import { api, newIdempotencyKey } from "../../../../lib/api";
import { dateInputToIso, dateTimeInputToIso, nowInputValue } from "../../../../lib/format";
import { errorMessage } from "../../../../lib/hooks";
import { currentInstructionLabel, parseInstruction } from "../../../../lib/transition";
import type { ProposalDto, SnapshotMedication } from "../../../../lib/types";

const UNITS = ["tablet", "capsule", "ml", "strip", "bottle", "vial", "sachet", "tube"] as const;
const DAYS = ["7", "10", "15", "30", "60", "90"] as const;
const OTHER_MEDICINE = "__other__";

/**
 * Pharmacy dispense record (docs_v2/06 P12): the medicine (from the shared
 * list when the link grants it, else typed), quantity, days supply and the
 * invoice number. The patient sees "<pharmacy> recorded a refill" and
 * accepts it; only then does their quantity-on-hand move. The API has no
 * dedicated invoice field, so the number travels in `notes`.
 */
export default function DispensePage({ params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = use(params);
  return (
    <WorkflowFrame linkId={linkId} kind="dispense" title="Record a dispense">
      {(snapshot) => <DispenseForm linkId={linkId} medications={snapshot.currentMedications ?? []} />}
    </WorkflowFrame>
  );
}

function DispenseForm({ linkId, medications }: { linkId: string; medications: SnapshotMedication[] }) {
  const listed = medications.filter((m): m is SnapshotMedication & { patientMedicationId: string } => typeof m.patientMedicationId === "string");
  const [picked, setPicked] = useState<string | undefined>(listed.length === 0 ? OTHER_MEDICINE : undefined);
  const [typedName, setTypedName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<(typeof UNITS)[number]>("tablet");
  const [days, setDays] = useState<string | undefined>("30");
  const [dispensedAt, setDispensedAt] = useState(nowInputValue());
  const [invoice, setInvoice] = useState("");
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [sent, setSent] = useState<ProposalDto | undefined>();

  const pickedMedicine = listed.find((m) => m.patientMedicationId === picked);
  const medicineName = picked === OTHER_MEDICINE ? typedName.trim() : (pickedMedicine?.name ?? "");
  const qty = Number(quantity);
  const dispensedIso = dateTimeInputToIso(dispensedAt);
  const valid = medicineName.length > 0 && Number.isFinite(qty) && qty > 0 && qty <= 100000 && !!dispensedIso && (!expiry || !!dateInputToIso(expiry));

  async function send() {
    setBusy(true);
    setError(undefined);
    try {
      const proposal = await api.post<ProposalDto>(
        `/provider/patients/${encodeURIComponent(linkId)}/dispenses`,
        {
          patientMedicationId: pickedMedicine?.patientMedicationId ?? null,
          medicineName,
          dispensedAt: dispensedIso,
          quantity: qty,
          unit,
          daysSupply: days ? Number(days) : null,
          lotNumber: lot.trim() || null,
          expiryDate: dateInputToIso(expiry) ?? null,
          notes: invoice.trim() ? `Invoice ${invoice.trim()}` : null,
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
      {listed.length > 0 ? (
        <ChoiceGrid
          label="Medicine dispensed"
          columns={1}
          choices={[
            ...listed.map((m) => ({
              value: m.patientMedicationId,
              label: m.strengthLabel ? `${m.name} ${m.strengthLabel}` : m.name,
              description: currentInstructionLabel({ instruction: parseInstruction(m.instruction), instructionSummary: m.instructionSummary }),
            })),
            { value: OTHER_MEDICINE, label: "Not on the patient's list — type the name" },
          ]}
          value={picked}
          onChange={setPicked}
        />
      ) : (
        <Banner tone="info">The patient's medicine list is not shared with this link; type the medicine name.</Banner>
      )}
      {picked === OTHER_MEDICINE ? <TextInput label="Medicine name" maxLength={200} value={typedName} onChange={(e) => setTypedName(e.target.value)} /> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--space-md)" }}>
        <TextInput label="Quantity" type="number" inputMode="decimal" min={0.5} step={0.5} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <TextInput label="Dispensed on" type="datetime-local" value={dispensedAt} onChange={(e) => setDispensedAt(e.target.value)} />
      </div>
      <ChoiceGrid label="Unit" columns={4} minItemWidth={96} choices={UNITS.map((u) => ({ value: u, label: u }))} value={unit} onChange={setUnit} />
      <ChoiceGrid label="Days supply" columns={6} minItemWidth={96} choices={DAYS.map((d) => ({ value: d, label: `${d} days` }))} value={days} onChange={setDays} />
      <TextInput label="Invoice number (optional)" maxLength={60} value={invoice} onChange={(e) => setInvoice(e.target.value)} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--space-md)" }}>
        <TextInput label="Batch / lot (optional)" maxLength={60} value={lot} onChange={(e) => setLot(e.target.value)} />
        <TextInput label="Expiry (optional)" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </div>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Button type="submit" loading={busy} disabled={busy || !valid}>
        Send to the patient
      </Button>
    </form>
  );
}
