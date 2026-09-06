"use client";
import { Chip } from "@medpass/ui-web";
import { proposalStatusLabel } from "../lib/proposal-kinds";

export function ProposalStatusChip({ status }: { status: string }) {
  const { label, tone } = proposalStatusLabel(status);
  return (
    <span data-testid="proposal-status" data-status={status}>
      <Chip tone={tone}>{label}</Chip>
    </span>
  );
}
