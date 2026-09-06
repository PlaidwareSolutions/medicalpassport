"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Banner, PillSpinner } from "@medpass/ui-web";
import { useSnapshot } from "../lib/hooks";
import { canSend, PROPOSAL_KIND_LABELS, type ProposalKind } from "../lib/proposal-kinds";
import { useProviderSession } from "../lib/session";
import { patientLabel } from "../lib/format";
import type { SnapshotDto } from "../lib/types";
import { ProviderShell } from "./ProviderShell";

/**
 * Frame for every "send a proposal" screen: refuses kinds this organization
 * may not send (the API would 403 anyway — the UI simply never offers
 * them), loads the snapshot the workflow reads from, and states the rule
 * that governs all of them: the patient decides.
 */
export function WorkflowFrame({
  linkId,
  kind,
  title,
  children,
}: {
  linkId: string;
  kind: ProposalKind;
  title: string;
  children: (snapshot: SnapshotDto) => ReactNode;
}) {
  return (
    <ProviderShell maxWidth={760}>
      <Body linkId={linkId} kind={kind} title={title}>
        {children}
      </Body>
    </ProviderShell>
  );
}

function Body({ linkId, kind, title, children }: { linkId: string; kind: ProposalKind; title: string; children: (snapshot: SnapshotDto) => ReactNode }) {
  const { organization } = useProviderSession();
  const snapshot = useSnapshot(linkId);
  const allowed = organization ? canSend(organization.kind, kind, organization.allowedProposalKinds) : false;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      <nav aria-label="Breadcrumb" style={{ fontSize: "var(--font-small)" }}>
        <Link href={`/patients/${encodeURIComponent(linkId)}`}>← Back to the patient</Link>
      </nav>
      <h1 style={{ fontSize: "var(--font-title)", margin: 0 }}>{title}</h1>
      {snapshot.data ? <p style={{ margin: 0, color: "var(--color-text-muted)" }}>{patientLabel(snapshot.data.profile)}</p> : null}
      {!allowed ? (
        <Banner tone="warning">
          A {organization?.kind.replace(/_/g, " ")} cannot send a {PROPOSAL_KIND_LABELS[kind].toLowerCase()} proposal.
        </Banner>
      ) : null}
      {snapshot.loading ? <PillSpinner label="Loading the patient's shared record…" /> : null}
      {snapshot.error ? <Banner tone="danger">{snapshot.error}</Banner> : null}
      {allowed && snapshot.data ? (
        <>
          <Banner tone="info">This is the patient's own record. What you send is a proposal — they decide what to accept.</Banner>
          {children(snapshot.data)}
        </>
      ) : null}
    </div>
  );
}
