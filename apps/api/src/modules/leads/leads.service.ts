import { Injectable, Logger } from "@nestjs/common";
import type { CreateLeadInput } from "@medpass/validation";
import { env } from "../../common/env";
import { PrismaService } from "../../common/prisma.service";

/** Controlled attribution values — never a caller-supplied free string (§17). */
export const LEAD_SOURCES = ["website-for-clinics"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

@Injectable()
export class LeadsService {
  private readonly logger = new Logger("LeadsService");

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist a professional lead (OD-LP-2). Business contact info only — the
   * `.strict()` schema already rejected anything else upstream. The lead is
   * always persisted first so nothing is lost even when no notification
   * recipient is configured (OD-LP-7 not yet finalized); notification is
   * best-effort on top.
   */
  async create(input: CreateLeadInput, source: LeadSource) {
    const lead = await this.prisma.professionalLead.create({
      data: {
        name: input.name,
        organization: input.organization,
        role: input.role,
        city: input.city,
        email: input.email ?? null,
        phone: input.phone ?? null,
        message: input.message ?? null,
        consentToContact: input.consentToContact,
        source,
      },
    });

    // Notification is best-effort and must never fail the request. A real
    // email transport isn't a configured vendor yet, so today this is a
    // structured log line the daily operational-report and Railway log
    // viewer surface (same pattern as OD-13's operational report). When
    // LEAD_NOTIFY_EMAIL + a transport exist, wire the send here.
    // Deliberately logs only non-sensitive routing fields — never email,
    // phone, or message (§21).
    const notifyTo = env().LEAD_NOTIFY_EMAIL;
    this.logger.log(
      { leadId: lead.id, organization: lead.organization, role: lead.role, city: lead.city, source, notifyConfigured: Boolean(notifyTo) },
      "new professional lead",
    );

    return { id: lead.id };
  }
}
