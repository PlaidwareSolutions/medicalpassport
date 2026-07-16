import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";

export interface VisitSummarySections {
  medications: boolean;
  allergies: boolean;
  conditions: boolean;
  recentChanges: boolean;
  concerns: boolean;
}

export const ALL_SECTIONS: VisitSummarySections = {
  medications: true,
  allergies: true,
  conditions: true,
  recentChanges: true,
  concerns: true,
};

export interface VisitSummaryDto {
  profile: { displayName: string; yearOfBirth: number | null; sex: string | null };
  /** Always present — proves the summary was built just now, not cached stale (docs/12 H-12). */
  generatedAt: string;
  allergies?: Array<{ label: string; severity: string; reactionNote: string | null }>;
  conditions?: Array<{ label: string; note: string | null }>;
  currentMedications?: Array<{
    id: string;
    name: string;
    ingredients: string[];
    strengthLabel: string | null;
    instructionSummary: string;
    prescriberName: string | null;
    startDate: string | null;
  }>;
  recentChanges?: Array<{ medicationName: string; change: string; occurredAt: string }>;
  unresolvedConcerns?: Array<{ category: string; severity: string; summary: string }>;
}

const RECENT_DAYS = 90;

/**
 * Doctor-visit mode data (docs/07 screen 28) and the public share payload
 * (docs/07 screen 29) are the same aggregation — the only difference is
 * which `sections` are included. Always computed live from current data,
 * never served from a frozen snapshot (docs/12).
 */
@Injectable()
export class VisitSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async build(profileId: string, sections: VisitSummarySections): Promise<VisitSummaryDto> {
    const profile = await this.prisma.patientProfile.findUniqueOrThrow({ where: { id: profileId } });
    const summary: VisitSummaryDto = {
      profile: { displayName: profile.displayName, yearOfBirth: profile.yearOfBirth, sex: profile.sex },
      generatedAt: new Date().toISOString(),
    };

    if (sections.allergies) {
      const allergies = await this.prisma.patientAllergy.findMany({
        where: { patientProfileId: profileId, active: true, deletedAt: null },
        orderBy: { createdAt: "desc" },
      });
      summary.allergies = allergies.map((a) => ({ label: a.label, severity: a.severity, reactionNote: a.reactionNote }));
    }

    if (sections.conditions) {
      const conditions = await this.prisma.patientCondition.findMany({
        where: { patientProfileId: profileId, active: true, deletedAt: null },
        orderBy: { createdAt: "desc" },
      });
      summary.conditions = conditions.map((c) => ({ label: c.label, note: c.note }));
    }

    if (sections.medications) {
      const meds = await this.prisma.patientMedication.findMany({
        where: { patientProfileId: profileId, status: "current", deletedAt: null },
        include: {
          product: { include: { brand: true, ingredients: { include: { ingredient: true } } } },
          practitioner: true,
          instructions: { where: { supersededAt: null }, take: 1 },
        },
        orderBy: { createdAt: "asc" },
      });
      summary.currentMedications = meds.map((m) => {
        const instruction = m.instructions[0];
        return {
          id: m.id,
          name: m.product?.brand?.name ?? m.enteredName,
          ingredients: m.product?.ingredients.map((i) => i.ingredient.name) ?? [],
          strengthLabel: m.product?.strengthLabel ?? null,
          instructionSummary: instruction
            ? `${instruction.doseQuantity} ${instruction.doseUnit} · ${instruction.frequencyCode}${instruction.pattern ? ` ${instruction.pattern}` : ""} · ${instruction.foodInstruction}`
            : "",
          prescriberName: m.practitioner?.displayName ?? null,
          startDate: m.startDate?.toISOString().slice(0, 10) ?? null,
        };
      });
    }

    if (sections.recentChanges) {
      const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
      const changes = await this.prisma.medicationChange.findMany({
        where: { occurredAt: { gte: cutoff }, patientMedication: { patientProfileId: profileId } },
        include: { patientMedication: { select: { enteredName: true } } },
        orderBy: { occurredAt: "desc" },
        take: 20,
      });
      summary.recentChanges = changes.map((c) => ({
        medicationName: c.patientMedication.enteredName,
        change: c.change,
        occurredAt: c.occurredAt.toISOString(),
      }));
    }

    if (sections.concerns) {
      const latestEvaluation = await this.prisma.safetyEvaluation.findFirst({
        where: { patientProfileId: profileId },
        orderBy: { startedAt: "desc" },
      });
      const findings = latestEvaluation
        ? await this.prisma.safetyFinding.findMany({
            where: { evaluationId: latestEvaluation.id, status: { in: ["open", "acknowledged"] } },
            orderBy: { severity: "desc" },
          })
        : [];
      summary.unresolvedConcerns = findings.map((f) => ({
        category: f.category,
        severity: f.severity,
        summary: (f.detail as { medicationNames?: string[]; medicationName?: string } | null)?.medicationNames?.join(" + ") ??
          (f.detail as { medicationName?: string } | null)?.medicationName ??
          f.category,
      }));
    }

    return summary;
  }
}
