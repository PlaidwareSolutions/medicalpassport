"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { MessageKey } from "@medpass/localization";
import { ApiError } from "@medpass/api-client";
import { DOSE_UNITS, type DoseUnit } from "@medpass/domain";
import { Banner, Button, Card, Chip, ChoiceGrid, PillSpinner, SectionTitle, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../../components/AppShell";
import { PageCrop } from "../../../../components/PageCrop";
import { PageHeader } from "../../../../components/PageHeader";
import {
  confirmCandidate,
  correctionChoices,
  displayableGroups,
  effectiveValue,
  entityHref,
  entityTypeLabelKey,
  fetchDocument,
  fetchExtraction,
  fieldLabelKey,
  groupTitle,
  invalidateMaterializedData,
  materializeExtraction,
  processDocument,
  rejectCandidate,
  valueText,
  type CandidateDto,
  type CandidateGroupDto,
  type CorrectionChoice,
  type DocumentDetailDto,
  type ExtractionResponseDto,
  type TypedMedication,
} from "../../../../lib/documents";
import { useI18n } from "../../../../lib/i18n";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

interface Decision {
  selected: boolean;
  correction?: unknown;
}

interface MedicationInput {
  doseUnit: DoseUnit;
  doseQuantity: string;
  frequency?: { code: string; pattern?: string };
}

const POLL_MS = 1500;
const POLL_TIMEOUT_MS = 150_000;

function groupId(g: Pick<CandidateGroupDto, "targetEntity" | "groupKey">): string {
  return `${g.targetEntity}|${g.groupKey ?? ""}`;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * "Check what we found" (docs_v2/09 §10, §6): every candidate beside the
 * exact line it was read from, grouped the way the page groups them — one
 * medicine, one lab row, one doctor. High-confidence proposals arrive
 * pre-selected as "Looks right?", medium ones ask "Please check", and low
 * ones sit behind "Other things we saw", never pre-selected. Nothing is
 * written until "Save all confirmed"; a "No" is recorded at once so the
 * proposal can never be saved later.
 *
 * Dose quantity is never a proposal (H-02): a medicine is created only
 * with the amount the person picks here. A lab value and its unit are two
 * separate rows with two separate "Yes"es (H-35).
 */
export default function ReviewDocumentPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const documentId = params.id;

  const [doc, setDoc] = useState<DocumentDetailDto | undefined>();
  const [extraction, setExtraction] = useState<ExtractionResponseDto | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [timedOut, setTimedOut] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [focus, setFocus] = useState<Record<string, string>>({});
  const [showLow, setShowLow] = useState<Record<string, boolean>>({});
  const [correcting, setCorrecting] = useState<string | undefined>();
  const [medInputs, setMedInputs] = useState<Record<string, MedicationInput>>({});
  const [busyCandidate, setBusyCandidate] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const startedAt = useRef(Date.now());

  async function load(): Promise<ExtractionResponseDto | undefined> {
    try {
      const [d, e] = await Promise.all([fetchDocument(documentId), fetchExtraction(documentId)]);
      setDoc(d);
      setExtraction(e);
      return e;
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
      return undefined;
    }
  }

  useEffect(() => {
    startedAt.current = Date.now();
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const reading =
    !!extraction &&
    !loadError &&
    (extraction.extraction === null || extraction.extraction.status === "running") &&
    extraction.status !== "failed" &&
    extraction.status !== "quarantined";

  useEffect(() => {
    if (!reading || timedOut) return;
    if (Date.now() - startedAt.current > POLL_TIMEOUT_MS) {
      setTimedOut(true);
      return;
    }
    const timer = setTimeout(() => void load(), POLL_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraction, reading, timedOut]);

  const groups = useMemo(() => (extraction?.extraction ? displayableGroups(extraction.extraction.groups) : []), [extraction]);

  // Pre-selection happens once per candidate: high confidence = selected,
  // everything else waits for a tap (docs_v2/09 §6).
  useEffect(() => {
    if (groups.length === 0) return;
    setDecisions((prev) => {
      const next = { ...prev };
      for (const g of groups) {
        for (const c of g.candidates) {
          if (next[c.id]) continue;
          next[c.id] = {
            selected: c.status === "confirmed" || c.status === "corrected" || (c.status === "proposed" && c.confidenceBucket === "high"),
            correction: c.status === "corrected" ? c.correctedValue : undefined,
          };
        }
      }
      return next;
    });
    setFocus((prev) => {
      const next = { ...prev };
      for (const g of groups) if (!next[groupId(g)]) next[groupId(g)] = g.candidates[0]!.id;
      return next;
    });
    setMedInputs((prev) => {
      const next = { ...prev };
      for (const g of groups) {
        if (g.targetEntity !== "medication" || next[groupId(g)]) continue;
        next[groupId(g)] = { doseUnit: "tablet", doseQuantity: "1" };
      }
      return next;
    });
  }, [groups]);

  const corrections = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const [id, d] of Object.entries(decisions)) if (d.correction !== undefined) out[id] = d.correction;
    return out;
  }, [decisions]);

  function isSaveable(c: CandidateDto): boolean {
    return c.status !== "rejected" && !c.resultingEntityId && decisions[c.id]?.selected === true;
  }

  function anchorOf(g: CandidateGroupDto): CandidateDto | undefined {
    return g.candidates.find((c) => (c.targetField === "brandName" || c.targetField === "genericName") && isSaveable(c));
  }

  function selectedFrequency(g: CandidateGroupDto): CandidateDto | undefined {
    return g.candidates.find((c) => c.targetField === "frequency" && isSaveable(c));
  }

  /** A medication group that has a medicine name selected must also have a typed dose and a frequency before it can be saved. */
  function medicationBlocker(g: CandidateGroupDto): MessageKey | null {
    if (g.targetEntity !== "medication") return null;
    if (!anchorOf(g)) {
      // Without a name there is nothing to build the medicine from, and
      // saving used to "succeed" while creating nothing at all (2026-09-07
      // UI review). Say so, and only when the patient has actually said Yes
      // to something in this group — an untouched group blocks nobody.
      return g.candidates.some(isSaveable) ? "documents.need_medicine_name" : null;
    }
    const input = medInputs[groupId(g)];
    if (!input || !(Number(input.doseQuantity) > 0)) return "documents.need_dose";
    if (!selectedFrequency(g) && !input.frequency) return "documents.need_frequency";
    return null;
  }

  const selectedCount = groups.reduce((n, g) => n + g.candidates.filter(isSaveable).length, 0);
  const blockers = groups.map(medicationBlocker).filter((b): b is MessageKey => b !== null);
  const allDecided = groups.length > 0 && groups.every((g) => g.candidates.every((c) => c.status === "rejected" || !!c.resultingEntityId));

  function setSelected(c: CandidateDto, selected: boolean) {
    setDecisions((prev) => ({ ...prev, [c.id]: { ...prev[c.id], selected } }));
  }

  function setCorrection(c: CandidateDto, correction: unknown) {
    setDecisions((prev) => ({ ...prev, [c.id]: { selected: true, correction: sameValue(correction, c.proposedValue) ? undefined : correction } }));
  }

  async function reject(c: CandidateDto) {
    setBusyCandidate(c.id);
    setSaveError(undefined);
    try {
      await rejectCandidate(c.id);
      setExtraction((prev) => (prev ? withCandidate(prev, c.id, (x) => ({ ...x, status: "rejected" })) : prev));
      setDecisions((prev) => ({ ...prev, [c.id]: { selected: false } }));
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setBusyCandidate(undefined);
    }
  }

  async function saveAll() {
    const ext = extraction?.extraction;
    if (!ext || selectedCount === 0 || blockers.length > 0) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      // 1. Corrections are recorded as the confirmed value before anything
      //    is built from them — the batch call below carries ids only.
      for (const g of groups) {
        for (const c of g.candidates) {
          const correction = decisions[c.id]?.correction;
          if (isSaveable(c) && correction !== undefined && !sameValue(correction, c.correctedValue)) {
            await confirmCandidate(c.id, { correctedValue: correction });
          }
        }
      }

      // 2. Everything that is not a medicine lands in one transaction:
      //    prescription/report first, then the doctor, the clinic, the lab
      //    rows — the API orders the containers itself (H-36).
      const structuralIds = groups.filter((g) => g.targetEntity !== "medication").flatMap((g) => g.candidates.filter(isSaveable).map((c) => c.id));
      if (structuralIds.length > 0) await materializeExtraction(ext.id, structuralIds);

      // 3. Each medicine is built from its own group with its own typed
      //    dose (H-02): siblings first, then the name — the call carrying
      //    the dose is the one that creates the medicine.
      for (const g of groups.filter((x) => x.targetEntity === "medication")) {
        const anchor = anchorOf(g);
        if (!anchor) continue;
        const input = medInputs[groupId(g)]!;
        for (const c of g.candidates) {
          if (c.id === anchor.id || !isSaveable(c)) continue;
          await confirmCandidate(c.id);
        }
        const medication: TypedMedication = {
          doseQuantity: Number(input.doseQuantity),
          doseUnit: input.doseUnit,
          ...(selectedFrequency(g) ? {} : { frequencyCode: input.frequency!.code, ...(input.frequency!.pattern ? { pattern: input.frequency!.pattern } : {}) }),
        };
        await confirmCandidate(anchor.id, { medication });
      }

      invalidateMaterializedData();
      await load();
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function retry() {
    setRetrying(true);
    setLoadError(undefined);
    setTimedOut(false);
    try {
      await processDocument(documentId);
      startedAt.current = Date.now();
      await load();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setRetrying(false);
    }
  }

  // --- views --------------------------------------------------------------

  if (loadError) {
    return (
      <AppShell>
        <PageHeader title={t("documents.review_title")} />
        <Banner tone="danger">{loadError}</Banner>
        <Link href={`/documents/${documentId}`}>
          <Button variant="secondary" fullWidth>
            {t("documents.see_document")}
          </Button>
        </Link>
      </AppShell>
    );
  }

  if (!extraction || !doc) {
    return (
      <AppShell>
        <PageHeader title={t("documents.review_title")} />
        <PillSpinner label={t("common.loading")} />
      </AppShell>
    );
  }

  if (extraction.status === "failed" || extraction.extraction?.status === "failed" || extraction.status === "quarantined" || timedOut) {
    return (
      <AppShell>
        <PageHeader title={t("documents.review_title")} />
        <Banner tone="danger">{extraction.status === "quarantined" ? t("documents.quarantined") : t("scan.process_error")}</Banner>
        <div style={{ marginTop: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {extraction.status !== "quarantined" ? (
            <Button fullWidth loading={retrying} disabled={retrying} onClick={() => void retry()}>
              {t("scan.try_again")}
            </Button>
          ) : null}
          <Link href={`/documents/${documentId}`}>
            <Button variant="secondary" fullWidth>
              {t("documents.see_document")}
            </Button>
          </Link>
          <Link href="/add">
            <Button variant="ghost" fullWidth>
              {t("scan.add_manually")}
            </Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  if (reading) {
    return (
      <AppShell>
        <PageHeader title={t("documents.review_title")} />
        <Card>
          <PillSpinner label={t("documents.reading")} />
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("scan.processing_hint")}</span>
        </Card>
        <div style={{ marginTop: "var(--space-md)" }}>
          <Link href={`/documents/${documentId}`}>
            <Button variant="ghost" fullWidth>
              {t("documents.see_document")}
            </Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  if (saved || allDecided) {
    return <DoneView documentId={documentId} groups={groups} t={t} />;
  }

  if (groups.length === 0) {
    return (
      <AppShell>
        <PageHeader title={t("documents.review_title")} readAloud={[{ audio: "screen.documents_review" }]} />
        <Card tone="info">
          <strong>{t("documents.nothing_found_title")}</strong>
          <span>{t("documents.nothing_found_body")}</span>
        </Card>
        <div style={{ marginTop: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <Link href={`/documents/${documentId}`}>
            <Button variant="secondary" fullWidth>
              {t("documents.see_document")}
            </Button>
          </Link>
          <Link href="/add">
            <Button variant="ghost" fullWidth>
              {t("scan.add_manually")}
            </Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  const pageFor = (n: number | null) => doc.pages.find((p) => p.pageNumber === n) ?? null;

  return (
    <AppShell>
      <PageHeader title={t("documents.review_title")} readAloud={[{ audio: "screen.documents_review" }]} style={{ margin: "0 0 var(--space-xs)" }} />
      <p style={{ color: "var(--color-text-muted)", margin: "0 0 var(--space-md)" }}>{t("documents.review_intro")}</p>

      {saveError ? <Banner tone="danger">{saveError}</Banner> : null}

      {groups.map((g) => {
        const gid = groupId(g);
        const focused = g.candidates.find((c) => c.id === focus[gid]) ?? g.candidates[0]!;
        const page = pageFor(focused.pageNumber);
        const main = g.candidates.filter((c) => c.confidenceBucket !== "low");
        const low = g.candidates.filter((c) => c.confidenceBucket === "low");
        const blocker = medicationBlocker(g);
        const input = medInputs[gid];
        const anchor = g.targetEntity === "medication" ? anchorOf(g) : undefined;

        return (
          <section key={gid} aria-label={groupTitle(g, t, corrections)} data-testid="candidate-group" data-entity={g.targetEntity} style={{ marginBottom: "var(--space-lg)" }}>
            <SectionTitle>{groupTitle(g, t, corrections)}</SectionTitle>
            <PageCrop src={page?.downloadUrl ?? null} box={focused.boundingBox} pageNumber={focused.pageNumber} contentType={page?.contentType} />

            {g.targetEntity === "diagnostic_result" ? (
              <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)", margin: "var(--space-sm) 0 0" }}>{t("documents.lab_unit_note")}</p>
            ) : null}

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
              {main.map((c) => (
                <CandidateRow
                  key={c.id}
                  candidate={c}
                  decision={decisions[c.id]}
                  focused={c.id === focused.id}
                  busy={busyCandidate === c.id || saving}
                  correcting={correcting === c.id}
                  t={t}
                  onFocus={() => setFocus((prev) => ({ ...prev, [gid]: c.id }))}
                  onYes={() => {
                    setSelected(c, !(decisions[c.id]?.selected ?? false));
                    setFocus((prev) => ({ ...prev, [gid]: c.id }));
                  }}
                  onNo={() => void reject(c)}
                  onToggleCorrect={() => {
                    setCorrecting((prev) => (prev === c.id ? undefined : c.id));
                    setFocus((prev) => ({ ...prev, [gid]: c.id }));
                  }}
                  onCorrect={(value) => setCorrection(c, value)}
                />
              ))}
            </div>

            {low.length > 0 ? (
              <div style={{ marginTop: "var(--space-sm)" }}>
                <Button variant="ghost" fullWidth aria-expanded={!!showLow[gid]} onClick={() => setShowLow((prev) => ({ ...prev, [gid]: !prev[gid] }))}>
                  {showLow[gid] ? t("documents.other_hide") : t("documents.other_show", { n: low.length })}
                </Button>
                {showLow[gid] ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
                    {low.map((c) => (
                      <CandidateRow
                        key={c.id}
                        candidate={c}
                        decision={decisions[c.id]}
                        focused={c.id === focused.id}
                        busy={busyCandidate === c.id || saving}
                        correcting={correcting === c.id}
                        t={t}
                        onFocus={() => setFocus((prev) => ({ ...prev, [gid]: c.id }))}
                        onYes={() => {
                          setSelected(c, !(decisions[c.id]?.selected ?? false));
                          setFocus((prev) => ({ ...prev, [gid]: c.id }));
                        }}
                        onNo={() => void reject(c)}
                        onToggleCorrect={() => {
                          setCorrecting((prev) => (prev === c.id ? undefined : c.id));
                          setFocus((prev) => ({ ...prev, [gid]: c.id }));
                        }}
                        onCorrect={(value) => setCorrection(c, value)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {g.targetEntity === "medication" && anchor && input ? (
              <Card tone="info" style={{ marginTop: "var(--space-sm)" }} data-testid="medication-dose">
                <strong>{t("documents.dose_title")}</strong>
                <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("documents.dose_never_read")}</span>
                <ChoiceGrid
                  label={t("add.dose_unit_label")}
                  columns={2}
                  choices={DOSE_UNITS.map((u) => ({ value: u, label: t(`medicineType.${u}` as MessageKey) }))}
                  value={input.doseUnit}
                  onChange={(doseUnit) => setMedInputs((prev) => ({ ...prev, [gid]: { ...prev[gid]!, doseUnit } }))}
                />
                {input.doseUnit === "tablet" || input.doseUnit === "capsule" ? (
                  <ChoiceGrid
                    label={t("review.dose_prompt")}
                    columns={3}
                    choices={[
                      { value: "0.5", label: "½" },
                      { value: "1", label: "1" },
                      { value: "2", label: "2" },
                    ]}
                    value={input.doseQuantity}
                    onChange={(doseQuantity) => setMedInputs((prev) => ({ ...prev, [gid]: { ...prev[gid]!, doseQuantity } }))}
                  />
                ) : (
                  <TextInput
                    label={t("review.dose_prompt")}
                    help={t(`unit.${input.doseUnit}` as MessageKey)}
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min="0.1"
                    value={input.doseQuantity}
                    onChange={(e) => setMedInputs((prev) => ({ ...prev, [gid]: { ...prev[gid]!, doseQuantity: e.target.value } }))}
                  />
                )}
                {!selectedFrequency(g) ? (
                  <ChoiceGrid
                    label={t("documents.frequency_prompt")}
                    columns={2}
                    choices={frequencyChoices(t).map((c) => ({ value: c.key, label: c.label }))}
                    value={frequencyChoices(t).find((c) => sameValue(c.value, input.frequency))?.key}
                    onChange={(key) => {
                      const choice = frequencyChoices(t).find((c) => c.key === key);
                      if (choice) setMedInputs((prev) => ({ ...prev, [gid]: { ...prev[gid]!, frequency: choice.value as MedicationInput["frequency"] } }));
                    }}
                  />
                ) : null}
                {blocker ? <span style={{ color: "var(--color-danger)", fontSize: "var(--font-small)" }}>{t(blocker)}</span> : null}
                {blocker === "documents.need_medicine_name" && !g.candidates.some((c) => c.targetField === "brandName" || c.targetField === "genericName") ? (
                  // The reader found no name on this page, so there is no Yes
                  // to give. Offer the manual path instead of a dead end.
                  <Link href="/add" data-testid="add-medicine-manually">
                    <Button variant="secondary" fullWidth>
                      {t("documents.add_medicine_manually")}
                    </Button>
                  </Link>
                ) : null}
              </Card>
            ) : null}
            {g.targetEntity === "medication" && !anchor && g.candidates.some(isSaveable) ? (
              <Banner tone="warning">{t("documents.need_medicine_name")}</Banner>
            ) : null}
          </section>
        );
      })}

      <div style={{ position: "sticky", bottom: "calc(var(--bottom-nav-height, 0px) + var(--space-sm))", background: "var(--color-bg)", padding: "var(--space-sm) 0" }}>
        <Button fullWidth disabled={selectedCount === 0 || blockers.length > 0 || saving} loading={saving} onClick={() => void saveAll()}>
          {selectedCount > 0 ? t("documents.save_all_count", { n: selectedCount }) : t("documents.save_all")}
        </Button>
        <Link href={`/documents/${documentId}`} style={{ display: "block", textAlign: "center", marginTop: "var(--space-sm)", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
          {t("documents.decide_later")}
        </Link>
      </div>
    </AppShell>
  );
}

function withCandidate(res: ExtractionResponseDto, id: string, update: (c: CandidateDto) => CandidateDto): ExtractionResponseDto {
  if (!res.extraction) return res;
  return {
    ...res,
    extraction: {
      ...res.extraction,
      groups: res.extraction.groups.map((g) => ({ ...g, candidates: g.candidates.map((c) => (c.id === id ? update(c) : c)) })),
    },
  };
}

function frequencyChoices(t: Translate): CorrectionChoice[] {
  return correctionChoices({ targetEntity: "medication", targetField: "frequency" }, t) ?? [];
}

function CandidateRow({
  candidate: c,
  decision,
  focused,
  busy,
  correcting,
  t,
  onFocus,
  onYes,
  onNo,
  onToggleCorrect,
  onCorrect,
}: {
  candidate: CandidateDto;
  decision: Decision | undefined;
  focused: boolean;
  busy: boolean;
  correcting: boolean;
  t: Translate;
  onFocus: () => void;
  onYes: () => void;
  onNo: () => void;
  onToggleCorrect: () => void;
  onCorrect: (value: unknown) => void;
}) {
  const choices = correctionChoices(c, t);
  const value = effectiveValue(c, decision?.correction);
  const text = valueText(c, value, t);
  const label = t(fieldLabelKey(c.targetEntity, c.targetField));
  const rejected = c.status === "rejected";
  const alreadySaved = !!c.resultingEntityId;
  const selected = decision?.selected === true && !rejected;
  const currentKey = choices?.find((ch) => sameValue(ch.value, value))?.key;

  return (
    <Card
      data-testid="candidate"
      data-candidate-field={`${c.targetEntity}.${c.targetField}`}
      data-bucket={c.confidenceBucket}
      data-selected={selected ? "true" : "false"}
      style={{ borderColor: focused ? "var(--color-primary)" : undefined, opacity: rejected ? 0.7 : 1 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-sm)", flexWrap: "wrap" }}>
        <strong>{label}</strong>
        {alreadySaved ? (
          <Chip tone="success">{t("documents.saved_chip")}</Chip>
        ) : rejected ? (
          <Chip tone="warning">{t("review.rejected")}</Chip>
        ) : c.confidenceBucket === "high" ? (
          <Chip>{t("documents.bucket_high")}</Chip>
        ) : c.confidenceBucket === "medium" ? (
          <Chip tone="warning">{t("documents.bucket_medium")}</Chip>
        ) : (
          <Chip tone="default">{t("documents.bucket_low")}</Chip>
        )}
      </div>
      <div style={{ fontSize: "var(--font-large)", fontWeight: 600, overflowWrap: "anywhere" }} data-testid="candidate-value">
        {text || c.detectedText}
        {decision?.correction !== undefined ? <Chip tone="success">{t("documents.corrected_chip")}</Chip> : null}
      </div>
      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)", overflowWrap: "anywhere" }}>{t("review.detected", { text: c.detectedText })}</span>

      {!rejected && !alreadySaved ? (
        <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
          <Button variant={selected ? "primary" : "secondary"} aria-pressed={selected} disabled={busy} onClick={onYes} style={{ flex: "1 1 auto" }}>
            {selected ? t("documents.yes_selected") : t("documents.yes")}
          </Button>
          {choices ? (
            <Button variant="secondary" aria-expanded={correcting} disabled={busy} onClick={onToggleCorrect} style={{ flex: "1 1 auto" }}>
              {t("documents.change")}
            </Button>
          ) : null}
          <Button variant="ghost" disabled={busy} onClick={onNo} style={{ flex: "1 1 auto" }}>
            {t("documents.no")}
          </Button>
          {!focused ? (
            <Button variant="ghost" disabled={busy} onClick={onFocus} style={{ flex: "1 1 auto" }}>
              {t("documents.show_on_page")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {correcting && choices ? (
        <ChoiceGrid
          label={t("documents.change_label", { field: label })}
          columns={2}
          choices={choices.map((ch) => ({ value: ch.key, label: ch.label }))}
          value={currentKey}
          onChange={(key) => {
            const choice = choices.find((ch) => ch.key === key);
            if (choice) onCorrect(choice.value);
          }}
        />
      ) : null}
    </Card>
  );
}

/** What the confirmed candidates became — every created record with a link, in the order the page listed them. */
function DoneView({ documentId, groups, t }: { documentId: string; groups: CandidateGroupDto[]; t: Translate }) {
  const created = new Map<string, { entityType: string; entityId: string; title: string }>();
  for (const g of groups) {
    for (const c of g.candidates) {
      if (!c.resultingEntityType || !c.resultingEntityId) continue;
      const key = `${c.resultingEntityType}:${c.resultingEntityId}`;
      if (!created.has(key)) created.set(key, { entityType: c.resultingEntityType, entityId: c.resultingEntityId, title: groupTitle(g, t) });
    }
  }
  const rows = [...created.values()];

  return (
    <AppShell>
      <PageHeader title={t("documents.done_title")} readAloud={[{ audio: "screen.documents_done" }]} />
      <Card tone="info" data-testid="review-done">
        <span>{rows.length > 0 ? t("documents.done_body") : t("documents.done_body_empty")}</span>
      </Card>
      {rows.length > 0 ? (
        <>
          <SectionTitle>{t("documents.done_created")}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {rows.map((r) => {
              const href = entityHref(r.entityType, r.entityId);
              const body = (
                <Card>
                  <strong>{t(entityTypeLabelKey(r.entityType))}</strong>
                  <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{r.title}</span>
                  {href ? <Chip>{t("documents.open")}</Chip> : null}
                </Card>
              );
              return href ? (
                <Link key={`${r.entityType}:${r.entityId}`} href={href} data-testid="created-link" data-entity-type={r.entityType} style={{ textDecoration: "none", color: "inherit" }}>
                  {body}
                </Link>
              ) : (
                <div key={`${r.entityType}:${r.entityId}`}>{body}</div>
              );
            })}
          </div>
        </>
      ) : null}
      <div style={{ marginTop: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <Link href={`/documents/${documentId}`}>
          <Button variant="secondary" fullWidth>
            {t("documents.see_document")}
          </Button>
        </Link>
        <Link href="/documents">
          <Button variant="ghost" fullWidth>
            {t("documents.back_to_list")}
          </Button>
        </Link>
      </div>
    </AppShell>
  );
}
