"use client";
import { useState } from "react";
import Link from "next/link";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, Chip, ChoiceGrid, PillSpinner, SectionTitle, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { PageHeader } from "../../components/PageHeader";
import { isStepUpRequired } from "../../lib/api";
import { ABHA_LINK_METHODS, abhaLinkInit, abhaLinkVerify, abhaUnlink, useAbhaStatus, type AbhaLinkMethod } from "../../lib/abha";
import { useI18n } from "../../lib/i18n";
import { formatPatientDate, useActiveTimezone } from "../../lib/patient-time";

/**
 * ABHA (docs_v2/05 §10, docs_v2/08 M8A). Connecting an ABHA is entirely
 * optional — the app works the same without one — so this screen opens on
 * the plain fact of whether one is connected, and only then offers the
 * three ways to connect: by ABHA number, by the mobile number the ABHA was
 * made with, or by Aadhaar OTP.
 *
 * Unlinking says the true thing, before it is done: records already brought
 * in stay in the record and keep the provenance saying where they came
 * from. Only the identity link ends.
 */
export default function AbhaPage() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const { status, error, fromCache, reload } = useAbhaStatus();

  const [method, setMethod] = useState<AbhaLinkMethod>("abha_number");
  const [value, setValue] = useState("");
  const [txn, setTxn] = useState<{ transactionId: string; otpSentTo: string | null } | undefined>();
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const [unlinking, setUnlinking] = useState(false);

  function fail(err: unknown) {
    setFormError(isStepUpRequired(err) ? t("stepup.not_confirmed") : err instanceof ApiError ? err.problem.title : t("common.error_generic"));
  }

  async function sendCode() {
    setBusy(true);
    setFormError(undefined);
    try {
      const trimmed = value.trim();
      const res = await abhaLinkInit({
        method,
        ...(method === "abha_number" ? { abhaNumber: trimmed } : {}),
        ...(method === "mobile" ? { mobile: trimmed } : {}),
        ...(method === "aadhaar_otp" ? { aadhaar: trimmed } : {}),
      });
      setTxn({ transactionId: res.transactionId, otpSentTo: res.otpSentTo });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!txn) return;
    setBusy(true);
    setFormError(undefined);
    try {
      await abhaLinkVerify({ transactionId: txn.transactionId, otp });
      setTxn(undefined);
      setOtp("");
      setValue("");
      await reload();
    } catch (err) {
      fail(err);
      setOtp("");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    setFormError(undefined);
    try {
      await abhaUnlink();
      setUnlinking(false);
      await reload();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const inputProps = INPUT_BY_METHOD[method];

  return (
    <AppShell>
      <PageHeader title={t("abha.title")} readAloud={[{ text: `${t("abha.title")}. ${t("guide.screen.abha")}` }]} />

      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {fromCache ? <Banner tone="warning">{t("common.offline_banner")}</Banner> : null}
      {formError ? <Banner tone="danger">{formError}</Banner> : null}

      {status === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {status?.linked === false ? (
        <>
          <Card data-testid="abha-not-linked">
            <Chip tone="default">{t("abha.not_linked")}</Chip>
            <span>{t("abha.not_linked_body")}</span>
            <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("abha.optional_note")}</span>
          </Card>

          {txn ? (
            <Card style={{ marginTop: "var(--space-md)" }} data-testid="abha-otp">
              <strong>{t("abha.otp_title")}</strong>
              <span>{txn.otpSentTo ? t("abha.otp_sent_to", { destination: txn.otpSentTo }) : t("abha.otp_sent")}</span>
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
              <Button fullWidth loading={busy} disabled={busy || otp.length !== 6} onClick={() => void verify()} data-testid="abha-verify">
                {t("abha.verify")}
              </Button>
              <Button variant="ghost" fullWidth disabled={busy} onClick={() => { setTxn(undefined); setOtp(""); }}>
                {t("common.cancel")}
              </Button>
            </Card>
          ) : (
            <>
              <ChoiceGrid
                label={t("abha.method_label")}
                columns={1}
                choices={ABHA_LINK_METHODS.map((m) => ({ value: m, label: t(`abha.method.${m}` as never) }))}
                value={method}
                onChange={(next) => {
                  setMethod(next as AbhaLinkMethod);
                  setValue("");
                  setFormError(undefined);
                }}
              />
              <div style={{ marginTop: "var(--space-md)" }}>
                <TextInput
                  label={t(`abha.input.${method}` as never)}
                  help={t(`abha.input_help.${method}` as never)}
                  inputMode={inputProps.inputMode}
                  maxLength={inputProps.maxLength}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
              <Button fullWidth loading={busy} disabled={busy || value.trim().length === 0} onClick={() => void sendCode()} data-testid="abha-send-code">
                {t("abha.send_code")}
              </Button>
              <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("abha.send_code_hint")}</p>
            </>
          )}
        </>
      ) : null}

      {status?.linked === true ? (
        <>
          <Card data-testid="abha-linked">
            <Chip tone="success">{t("abha.linked")}</Chip>
            <strong style={{ fontSize: "var(--font-large)", overflowWrap: "anywhere" }}>{status.abhaNumberMasked}</strong>
            {status.abhaAddress ? <span style={{ overflowWrap: "anywhere" }}>{status.abhaAddress}</span> : null}
            <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
              {t("abha.linked_on", { date: formatPatientDate(status.linkedAt, timezone) })}
            </span>
            <span>{t("abha.care_context_count", { count: status.careContextCount })}</span>
          </Card>

          <SectionTitle>{t("abha.more_title")}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            <Link href="/abha/care-contexts">
              <Button variant="secondary" fullWidth>
                {t("abha.care_contexts_link")}
              </Button>
            </Link>
            <Link href="/abha/records">
              <Button variant="secondary" fullWidth>
                {t("abha.records_link")}
              </Button>
            </Link>
            <Link href="/abha/consents">
              <Button variant="secondary" fullWidth>
                {t("abha.consents_link")}
              </Button>
            </Link>
          </div>

          <SectionTitle>{t("abha.unlink_section")}</SectionTitle>
          {unlinking ? (
            <Card tone="warning">
              <strong>{t("abha.unlink_confirm_title")}</strong>
              {/* The honest consequence, before the button: unlinking ends the
                  identity link only (docs_v2/05 §10). */}
              <span>{t("abha.unlink_keeps_records")}</span>
              <span>{t("abha.unlink_stops_new")}</span>
              <Button fullWidth loading={busy} disabled={busy} onClick={() => void unlink()} data-testid="abha-unlink-confirm">
                {t("abha.unlink_confirm")}
              </Button>
              <Button variant="ghost" fullWidth disabled={busy} onClick={() => setUnlinking(false)}>
                {t("common.cancel")}
              </Button>
            </Card>
          ) : (
            <>
              <p style={{ margin: "0 0 var(--space-sm)", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("abha.unlink_keeps_records")}</p>
              <Button variant="secondary" fullWidth onClick={() => setUnlinking(true)} data-testid="abha-unlink">
                {t("abha.unlink")}
              </Button>
            </>
          )}
        </>
      ) : null}

      {status ? (
        <p style={{ marginTop: "var(--space-lg)", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
          {status.gatewayEnv === "mock" ? t("abha.mock_note") : t("abha.gateway_note", { env: status.gatewayEnv })}
        </p>
      ) : null}
    </AppShell>
  );
}

const INPUT_BY_METHOD: Record<AbhaLinkMethod, { inputMode: "numeric" | "tel"; maxLength: number }> = {
  abha_number: { inputMode: "numeric", maxLength: 17 },
  mobile: { inputMode: "tel", maxLength: 16 },
  aadhaar_otp: { inputMode: "numeric", maxLength: 12 },
};
