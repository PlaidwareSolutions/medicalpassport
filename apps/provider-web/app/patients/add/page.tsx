"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card } from "@medpass/ui-web";
import { ProviderShell } from "../../../components/ProviderShell";
import { QrScanner } from "../../../components/QrScanner";
import { TextArea } from "../../../components/TextArea";
import { api } from "../../../lib/api";
import { errorMessage } from "../../../lib/hooks";
import { extractOnboardingToken } from "../../../lib/onboarding";
import type { PatientLinkDto } from "../../../lib/types";

/**
 * QR patient onboarding (docs_v2/06 P11-3): the patient chooses what to
 * share and for how long, shows a code; scanning it (or pasting it) redeems
 * it once into a ProviderPatientLink. The token is a secret — it is sent to
 * the API and never put in a URL or a log.
 */
export default function AddPatientPage() {
  return (
    <ProviderShell maxWidth={640}>
      <AddPatient />
    </ProviderShell>
  );
}

function AddPatient() {
  const router = useRouter();
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function redeem(raw: string) {
    const token = extractOnboardingToken(raw);
    if (!token) {
      setError("That does not look like a patient code. Ask the patient to show a fresh one.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const link = await api.post<PatientLinkDto>("/provider/patients/onboard", { qrToken: token });
      router.replace(`/patients/${encodeURIComponent(link.linkId)}`);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? "This code is not valid. Ask the patient to show a new one." : errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      <h1 style={{ fontSize: "var(--font-title)", margin: 0 }}>Add a patient</h1>
      <p style={{ margin: 0, color: "var(--color-text-muted)" }}>
        The patient opens Medicine Passport, chooses which sections to share with you and for how long, and shows a QR code. It works once
        and expires quickly.
      </p>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Card>
        <QrScanner active={!busy} onCode={(raw) => void redeem(raw)} />
      </Card>
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void redeem(pasted);
          }}
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}
        >
          <TextArea
            label="Or paste the code"
            help="If the camera cannot be used, the patient can share the code as text."
            value={pasted}
            rows={2}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setPasted(e.target.value)}
            data-testid="onboarding-token"
          />
          <Button type="submit" loading={busy} disabled={busy || !extractOnboardingToken(pasted)} data-testid="redeem-token">
            Link patient
          </Button>
        </form>
      </Card>
    </div>
  );
}
