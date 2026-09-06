"use client";
import { use, useMemo, useState } from "react";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, PillSpinner, TextInput } from "@medpass/ui-web";
import { AwaitingAcceptance } from "../../../../components/AwaitingAcceptance";
import { Select } from "../../../../components/Select";
import { TextArea } from "../../../../components/TextArea";
import { WorkflowFrame } from "../../../../components/WorkflowFrame";
import { api, newIdempotencyKey } from "../../../../lib/api";
import { dateTimeInputToIso, nowInputValue } from "../../../../lib/format";
import { errorMessage, useAnalytes } from "../../../../lib/hooks";
import type { AnalyteDto, ProposalDto } from "../../../../lib/types";

interface ResultRow {
  id: string;
  analyteKey: string;
  analyteLabelText: string;
  enteredValueText: string;
  enteredUnit: string;
  referenceText: string;
  comparator: "" | "<" | ">" | "<=" | ">=";
}

function newRow(): ResultRow {
  return { id: crypto.randomUUID(), analyteKey: "", analyteLabelText: "", enteredValueText: "", enteredUnit: "", referenceText: "", comparator: "" };
}

const GROUP_LABELS: Record<string, string> = {
  cbc: "Blood counts",
  glucose: "Glucose",
  lipids: "Lipids",
  renal: "Kidney",
  liver: "Liver",
  thyroid: "Thyroid",
  vitamins: "Vitamins",
  electrolytes: "Electrolytes",
  urine: "Urine",
  other: "Other",
};

/**
 * Laboratory report proposal (docs_v2/06 P13): title, when, and result rows
 * with the analyte from the shared vocabulary, the value exactly as printed
 * (H-35: never converted here), the unit from that analyte's allowed units,
 * and the printed reference range. Lands `source_authenticated` after the
 * patient accepts it into their passport.
 */
export default function DiagnosticReportPage({ params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = use(params);
  return (
    <WorkflowFrame linkId={linkId} kind="diagnostic_report" title="Send a report">
      {() => <ReportForm linkId={linkId} />}
    </WorkflowFrame>
  );
}

function ReportForm({ linkId }: { linkId: string }) {
  const analytes = useAnalytes();
  const [title, setTitle] = useState("");
  const [reportedAt, setReportedAt] = useState(nowInputValue());
  const [specimenAt, setSpecimenAt] = useState("");
  const [reportingPractitioner, setReportingPractitioner] = useState("");
  const [orderingPractitioner, setOrderingPractitioner] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [rows, setRows] = useState<ResultRow[]>([newRow()]);
  const [step, setStep] = useState<"edit" | "review" | "sent">("edit");
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [sent, setSent] = useState<ProposalDto | undefined>();

  const byKey = useMemo(() => new Map((analytes.data?.items ?? []).map((a) => [a.key, a])), [analytes.data]);
  const options = useMemo(() => {
    const items = analytes.data?.items ?? [];
    const groups = new Map<string, AnalyteDto[]>();
    for (const a of items) groups.set(a.group, [...(groups.get(a.group) ?? []), a]);
    return [...groups.entries()].flatMap(([group, list]) => list.map((a) => ({ value: a.key, label: `${GROUP_LABELS[group] ?? group}: ${a.display}` })));
  }, [analytes.data]);

  function update(id: string, patch: Partial<ResultRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function unitOptions(a: AnalyteDto | undefined) {
    if (!a) return [];
    const seen = new Set<string>();
    const out: Array<{ value: string; label: string }> = [];
    for (const u of a.allowedEnteredUnits) {
      if (seen.has(u.unit)) continue;
      seen.add(u.unit);
      out.push({ value: u.unit, label: u.isCanonical ? `${u.display} (standard)` : u.display });
    }
    return out;
  }

  function validate(): string[] {
    const out: string[] = [];
    if (!title.trim()) out.push("Give the report a title");
    if (!dateTimeInputToIso(reportedAt)) out.push("Enter the report date");
    if (specimenAt && !dateTimeInputToIso(specimenAt)) out.push("Sample date is not valid");
    rows.forEach((r, i) => {
      const a = byKey.get(r.analyteKey);
      if (!r.analyteKey) out.push(`Row ${i + 1}: choose the test`);
      if (a?.openEntry && !r.analyteLabelText.trim()) out.push(`Row ${i + 1}: name the test as printed`);
      if (!r.enteredValueText.trim()) out.push(`Row ${i + 1}: enter the value as printed`);
      if (a && !a.openEntry && a.allowedEnteredUnits.length > 0 && !r.enteredUnit) out.push(`Row ${i + 1}: choose the unit as printed`);
    });
    if (rows.length === 0) out.push("Add at least one result");
    return out;
  }

  function body() {
    return {
      title: title.trim(),
      kind: "laboratory",
      status: "final",
      reportedAt: dateTimeInputToIso(reportedAt),
      specimenCollectedAt: dateTimeInputToIso(specimenAt),
      reportingPractitionerName: reportingPractitioner.trim() || undefined,
      orderingPractitionerName: orderingPractitioner.trim() || undefined,
      conclusionText: conclusion.trim() || undefined,
      results: rows.map((r, i) => ({
        sequence: i + 1,
        analyteKey: r.analyteKey,
        analyteLabelText: r.analyteLabelText.trim() || undefined,
        enteredValueText: r.enteredValueText.trim(),
        enteredUnit: r.enteredUnit || undefined,
        referenceText: r.referenceText.trim() || undefined,
        comparator: r.comparator || undefined,
      })),
    };
  }

  async function send() {
    setBusy(true);
    setError(undefined);
    try {
      const proposal = await api.post<ProposalDto>(`/provider/patients/${encodeURIComponent(linkId)}/diagnostic-reports`, body(), { idempotencyKey: newIdempotencyKey() });
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
          {title.trim()} · reported {reportedAt}
          {reportingPractitioner.trim() ? ` · ${reportingPractitioner.trim()}` : ""}
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {["Test", "Value", "Unit", "Reference"].map((h) => (
                  <th key={h} scope="col" style={{ textAlign: "start", padding: "var(--space-xs)", borderBottom: "1px solid var(--color-border)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: "var(--space-xs)" }}>{byKey.get(r.analyteKey)?.openEntry ? r.analyteLabelText : (byKey.get(r.analyteKey)?.display ?? r.analyteKey)}</td>
                  <td style={{ padding: "var(--space-xs)" }}>
                    {r.comparator}
                    {r.enteredValueText}
                  </td>
                  <td style={{ padding: "var(--space-xs)" }}>{r.enteredUnit || "—"}</td>
                  <td style={{ padding: "var(--space-xs)" }}>{r.referenceText || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {conclusion.trim() ? <p style={{ margin: 0, fontSize: "var(--font-small)" }}>{conclusion.trim()}</p> : null}
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
      <TextInput label="Report title" placeholder="e.g. Complete blood count" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-md)" }}>
        <TextInput label="Reported on" type="datetime-local" value={reportedAt} onChange={(e) => setReportedAt(e.target.value)} />
        <TextInput label="Sample collected on (optional)" type="datetime-local" value={specimenAt} onChange={(e) => setSpecimenAt(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-md)" }}>
        <TextInput label="Reporting pathologist (optional)" maxLength={120} value={reportingPractitioner} onChange={(e) => setReportingPractitioner(e.target.value)} />
        <TextInput label="Ordering doctor (optional)" maxLength={120} value={orderingPractitioner} onChange={(e) => setOrderingPractitioner(e.target.value)} />
      </div>

      <section aria-labelledby="results-heading" style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
        <h2 id="results-heading" style={{ fontSize: "var(--font-large)", margin: 0 }}>
          Results
        </h2>
        {analytes.loading ? <PillSpinner label="Loading the test vocabulary…" /> : null}
        {analytes.error ? <Banner tone="danger">{analytes.error}</Banner> : null}
        {rows.map((r, i) => {
          const analyte = byKey.get(r.analyteKey);
          const units = unitOptions(analyte);
          return (
            <Card key={r.id}>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                <Select label={`Row ${i + 1}: test`} options={options} value={r.analyteKey} placeholder="Choose the test" onChange={(v) => update(r.id, { analyteKey: v, enteredUnit: "" })} />
                {analyte?.openEntry ? (
                  <TextInput label={`Row ${i + 1}: test name as printed`} maxLength={80} value={r.analyteLabelText} onChange={(e) => update(r.id, { analyteLabelText: e.target.value })} />
                ) : null}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "var(--space-md)" }}>
                  <Select<"<" | ">" | "<=" | ">=">
                    label={`Row ${i + 1}: comparator`}
                    options={[
                      { value: "<", label: "<" },
                      { value: "<=", label: "≤" },
                      { value: ">", label: ">" },
                      { value: ">=", label: "≥" },
                    ]}
                    placeholder="(none)"
                    value={r.comparator}
                    onChange={(v) => update(r.id, { comparator: v })}
                  />
                  <TextInput label={`Row ${i + 1}: value as printed`} maxLength={60} inputMode="decimal" value={r.enteredValueText} onChange={(e) => update(r.id, { enteredValueText: e.target.value })} />
                  {analyte?.openEntry || units.length === 0 ? (
                    <TextInput label={`Row ${i + 1}: unit as printed`} maxLength={30} value={r.enteredUnit} onChange={(e) => update(r.id, { enteredUnit: e.target.value })} />
                  ) : (
                    <Select label={`Row ${i + 1}: unit as printed`} options={units} placeholder="Choose the unit" value={r.enteredUnit} onChange={(v) => update(r.id, { enteredUnit: v })} />
                  )}
                </div>
                <TextInput label={`Row ${i + 1}: reference range as printed (optional)`} maxLength={120} value={r.referenceText} onChange={(e) => update(r.id, { referenceText: e.target.value })} />
                {rows.length > 1 ? (
                  <Button variant="ghost" onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}>
                    Remove row {i + 1}
                  </Button>
                ) : null}
              </div>
            </Card>
          );
        })}
        <Button variant="secondary" onClick={() => setRows((prev) => (prev.length < 200 ? [...prev, newRow()] : prev))}>
          Add a result row
        </Button>
      </section>
      <TextArea label="Conclusion (optional)" maxLength={4000} value={conclusion} onChange={(e) => setConclusion(e.target.value)} />
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
        disabled={analytes.loading}
      >
        Review before sending
      </Button>
    </div>
  );
}
