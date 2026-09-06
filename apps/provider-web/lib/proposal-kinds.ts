/**
 * Which proposal kinds an organization may send, by kind (docs_v2/05 §11;
 * mirror of `PROPOSAL_KINDS_BY_ORGANIZATION` in
 * apps/api/src/modules/providers/provider-organizations.service.ts). The
 * server's `allowedProposalKinds` on the organization is authoritative —
 * this table can only narrow it, never widen it — so the UI never offers a
 * workflow the API would refuse with 403.
 */
export const ORGANIZATION_KINDS = ["clinic", "hospital", "laboratory", "pharmacy", "diagnostic_centre", "other"] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

export const PROPOSAL_KINDS = ["reconciliation", "prescription", "encounter", "dispense", "diagnostic_report", "discharge_transition"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export type ProposalStatus = "proposed" | "accepted" | "rejected" | "withdrawn" | "expired";

export const PROPOSAL_KINDS_BY_ORGANIZATION: Readonly<Record<OrganizationKind, readonly ProposalKind[]>> = {
  clinic: ["reconciliation", "prescription", "encounter"],
  hospital: ["reconciliation", "prescription", "encounter", "discharge_transition"],
  pharmacy: ["dispense"],
  laboratory: ["diagnostic_report"],
  diagnostic_centre: ["diagnostic_report"],
  other: [],
};

export function isOrganizationKind(value: string): value is OrganizationKind {
  return (ORGANIZATION_KINDS as readonly string[]).includes(value);
}

export function isProposalKind(value: string): value is ProposalKind {
  return (PROPOSAL_KINDS as readonly string[]).includes(value);
}

/**
 * The kinds to offer. With the server's list present, the result is the
 * intersection (an unknown or future kind the server allows but this build
 * has no screen for is dropped; a kind this table allows but the server
 * does not is dropped too). Without it, the local table alone.
 */
export function allowedProposalKinds(organizationKind: string, serverAllowed?: readonly string[]): ProposalKind[] {
  const local = isOrganizationKind(organizationKind) ? PROPOSAL_KINDS_BY_ORGANIZATION[organizationKind] : [];
  if (!serverAllowed) return [...local];
  return local.filter((kind) => serverAllowed.includes(kind));
}

export function canSend(organizationKind: string, kind: ProposalKind, serverAllowed?: readonly string[]): boolean {
  return allowedProposalKinds(organizationKind, serverAllowed).includes(kind);
}

export interface ProposalKindMeta {
  /** Button / heading label. */
  label: string;
  /** One line under the button. */
  description: string;
  /** Route segment under /patients/:linkId/. */
  route: string;
  /** API route segment under provider/patients/:linkId/. */
  apiSegment: string;
}

export const PROPOSAL_KIND_META: Readonly<Record<ProposalKind, ProposalKindMeta>> = {
  reconciliation: {
    label: "Reconcile medicines",
    description: "Go through every current medicine: continue, change or stop it, and add new ones.",
    route: "reconciliation",
    apiSegment: "reconciliations",
  },
  prescription: {
    label: "Record a prescription",
    description: "Capture what was prescribed today; the patient confirms each item.",
    route: "prescription",
    apiSegment: "prescriptions",
  },
  encounter: {
    label: "Record a visit",
    description: "Kind, date, summary and follow-up date for today's consultation.",
    route: "encounter",
    apiSegment: "encounters",
  },
  dispense: {
    label: "Record a dispense",
    description: "A refill handed over today: medicine, quantity, days supply.",
    route: "dispense",
    apiSegment: "dispenses",
  },
  diagnostic_report: {
    label: "Send a report",
    description: "A laboratory report with its result rows, exactly as printed.",
    route: "diagnostic-report",
    apiSegment: "diagnostic-reports",
  },
  discharge_transition: {
    label: "Discharge transition",
    description: "Every current medicine gets a decision; tests and follow-up after discharge.",
    route: "discharge",
    apiSegment: "discharge",
  },
};

export const PROPOSAL_KIND_LABELS: Readonly<Record<ProposalKind, string>> = {
  reconciliation: "Medicine reconciliation",
  prescription: "Prescription",
  encounter: "Visit",
  dispense: "Dispense",
  diagnostic_report: "Diagnostic report",
  discharge_transition: "Discharge transition",
};

export function proposalStatusLabel(status: ProposalStatus | string): { label: string; tone: "default" | "success" | "warning" | "danger" } {
  switch (status) {
    case "proposed":
      return { label: "Awaiting the patient's acceptance", tone: "warning" };
    case "accepted":
      return { label: "Accepted by the patient", tone: "success" };
    case "rejected":
      return { label: "Declined by the patient", tone: "danger" };
    case "expired":
      return { label: "Expired", tone: "default" };
    case "withdrawn":
      return { label: "Withdrawn", tone: "default" };
    default:
      return { label: status, tone: "default" };
  }
}

export const ORGANIZATION_KIND_LABELS: Readonly<Record<OrganizationKind, string>> = {
  clinic: "Clinic",
  hospital: "Hospital",
  laboratory: "Laboratory",
  pharmacy: "Pharmacy",
  diagnostic_centre: "Diagnostic centre",
  other: "Organization",
};

/** The portal "mode" a kind puts the UI in — copy only; the allowed-kinds table is what gates actions. */
export function organizationMode(kind: string): "clinic" | "hospital" | "pharmacy" | "laboratory" | "none" {
  switch (kind) {
    case "clinic":
      return "clinic";
    case "hospital":
      return "hospital";
    case "pharmacy":
      return "pharmacy";
    case "laboratory":
    case "diagnostic_centre":
      return "laboratory";
    default:
      return "none";
  }
}
