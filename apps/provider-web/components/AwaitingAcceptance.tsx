"use client";
import Link from "next/link";
import { Button, Card } from "@medpass/ui-web";
import { PROPOSAL_KIND_LABELS } from "../lib/proposal-kinds";
import type { ProposalDto } from "../lib/types";
import { ProposalStatusChip } from "./ProposalStatusChip";

/**
 * Every write on this portal ends here (ADR-V2-009: providers propose,
 * patients accept). Nothing has changed in the patient's record yet, and
 * the copy says so plainly.
 */
export function AwaitingAcceptance({ proposal, linkId }: { proposal: ProposalDto; linkId: string }) {
  return (
    <Card tone="info" data-testid="awaiting-acceptance">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <h2 style={{ margin: 0, fontSize: "var(--font-large)" }}>Sent — awaiting the patient's acceptance</h2>
        <ProposalStatusChip status={proposal.status} />
        <p style={{ margin: 0 }}>
          The {PROPOSAL_KIND_LABELS[proposal.kind].toLowerCase()} is now in the patient's Proposals inbox. Nothing in their record changes until they
          accept it; they can accept line by line, or decline it. You will see the outcome here.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
          <Link href={`/proposals/${encodeURIComponent(proposal.id)}`} style={{ textDecoration: "none" }}>
            <Button variant="secondary">View this proposal</Button>
          </Link>
          <Link href={`/patients/${encodeURIComponent(linkId)}`} style={{ textDecoration: "none" }}>
            <Button>Back to the patient</Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}
