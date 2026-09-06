"use client";
import { useState } from "react";
import Link from "next/link";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, Chip, PillSpinner, SectionTitle, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { PageHeader } from "../../../components/PageHeader";
import {
  abhaDiscover,
  abhaDiscoveryResult,
  linkCareContexts,
  useAbhaStatus,
  type DiscoveredPatient,
} from "../../../lib/abha";
import { useI18n } from "../../../lib/i18n";

/**
 * Care-context linking (docs_v2/08 M8B). A "care context" is ABDM's name
 * for one episode a hospital holds about you — an OPD visit, a lab panel.
 * Linking one tells that hospital it may send that episode to your ABHA;
 * it does not bring anything into this app by itself. What arrives lands in
 * "Records from ABDM" and still has to be confirmed row by row.
 *
 * The flow is discover → pick the episodes → confirm with the OTP the
 * hospital sends. Each step is shown as what it is, because a patient
 * asked for an OTP with no explanation of what it authorises is not
 * consenting to anything.
 */
export default function CareContextsPage() {
  const { t } = useI18n();
  const { status } = useAbhaStatus();

  const [txnId, setTxnId] = useState<string | undefined>();
  const [patients, setPatients] = useState<DiscoveredPatient[] | undefined>();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [target, setTarget] = useState<DiscoveredPatient | undefined>();
  const [needsOtp, setNeedsOtp] = useState(false);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [linked, setLinked] = useState<string[] | undefined>();

  function fail(err: unknown) {
    setError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
  }

  async function discover() {
    setBusy(true);
    setError(undefined);
    setLinked(undefined);
    try {
      const { transactionId } = await abhaDiscover();
      setTxnId(transactionId);
      const result = await abhaDiscoveryResult(transactionId);
      setPatients(result.patients);
      if (result.status === "failed") setError(t("abha.discover_failed"));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function link(patient: DiscoveredPatient, withOtp?: string) {
    if (!txnId) return;
    const references = patient.careContexts.filter((c) => selected[c.reference]).map((c) => c.reference);
    if (references.length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await linkCareContexts({
        transactionId: txnId,
        hipId: patient.hipId,
        patientReferenceNumber: patient.patientReferenceNumber,
        careContextReferences: references,
        ...(withOtp ? { otp: withOtp } : {}),
      });
      if (res.status === "otp_required") {
        setTarget(patient);
        setNeedsOtp(true);
        return;
      }
      if (res.status === "failed") {
        setError(t("abha.link_failed"));
        return;
      }
      setLinked(res.linked.map((c) => c.display));
      setNeedsOtp(false);
      setOtp("");
    } catch (err) {
      fail(err);
      setOtp("");
    } finally {
      setBusy(false);
    }
  }

  if (status?.linked === false) {
    return (
      <AppShell>
        <PageHeader title={t("abha.care_contexts_title")} />
        <Banner tone="warning">{t("abha.needs_link_first")}</Banner>
        <Link href="/abha">
          <Button fullWidth>{t("abha.back_to_abha")}</Button>
        </Link>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader title={t("abha.care_contexts_title")} readAloud={[{ text: `${t("abha.care_contexts_title")}. ${t("abha.care_contexts_intro")}` }]} />
      <p style={{ margin: "0 0 var(--space-md)" }}>{t("abha.care_contexts_intro")}</p>

      {error ? <Banner tone="danger">{error}</Banner> : null}
      {linked ? (
        <Card tone="info" data-testid="care-contexts-linked">
          <strong>{t("abha.link_done_title")}</strong>
          <span>{t("abha.link_done_body")}</span>
          {linked.map((display) => (
            <Chip key={display}>{display}</Chip>
          ))}
          <Link href="/abha/records">
            <Button variant="secondary" fullWidth>
              {t("abha.records_link")}
            </Button>
          </Link>
        </Card>
      ) : null}

      {patients === undefined ? (
        <>
          <Button fullWidth loading={busy} disabled={busy} onClick={() => void discover()} data-testid="abha-discover">
            {t("abha.discover")}
          </Button>
          <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("abha.discover_hint")}</p>
        </>
      ) : null}

      {busy && patients === undefined ? <PillSpinner label={t("common.loading")} /> : null}

      {patients && patients.length === 0 ? <Banner tone="info">{t("abha.discover_none")}</Banner> : null}

      {patients?.map((patient) => (
        <section key={patient.hipId} aria-label={patient.hipName}>
          <SectionTitle>{patient.hipName}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {patient.careContexts.map((context) => (
              <label
                key={context.reference}
                data-testid="care-context"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-sm)",
                  minHeight: "var(--size-touch)",
                  padding: "var(--space-sm)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={!!selected[context.reference]}
                  onChange={(e) => setSelected((prev) => ({ ...prev, [context.reference]: e.target.checked }))}
                  style={{ width: 24, height: 24 }}
                />
                <span style={{ overflowWrap: "anywhere" }}>{context.display}</span>
              </label>
            ))}
          </div>

          {needsOtp && target?.hipId === patient.hipId ? (
            <Card style={{ marginTop: "var(--space-sm)" }} data-testid="care-context-otp">
              <strong>{t("abha.care_context_otp_title")}</strong>
              <span>{t("abha.care_context_otp_body", { hospital: patient.hipName })}</span>
              <TextInput
                label={t("auth.code_label")}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                style={{ letterSpacing: "0.5em", textAlign: "center" }}
              />
              <Button fullWidth loading={busy} disabled={busy || otp.length !== 6} onClick={() => void link(patient, otp)} data-testid="care-context-verify">
                {t("abha.care_context_confirm")}
              </Button>
            </Card>
          ) : (
            <div style={{ marginTop: "var(--space-sm)" }}>
              <Button
                fullWidth
                loading={busy}
                disabled={busy || !patient.careContexts.some((c) => selected[c.reference])}
                onClick={() => void link(patient)}
                data-testid="link-care-contexts"
              >
                {t("abha.link_selected")}
              </Button>
            </div>
          )}
        </section>
      ))}

      <div style={{ marginTop: "var(--space-lg)" }}>
        <Link href="/abha">
          <Button variant="ghost" fullWidth>
            {t("abha.back_to_abha")}
          </Button>
        </Link>
      </div>
    </AppShell>
  );
}
