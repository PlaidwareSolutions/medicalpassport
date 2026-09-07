import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { PrismaService } from "../../common/prisma.service";
import {
  evaluateSafety,
  type AllergySnapshot,
  type InstructionSnapshot,
  type MedicationSnapshot,
  type RawFinding,
} from "./safety-rules";

const APP_VERSION = "0.1.0-dev";

@Injectable()
export class SafetyEvaluationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs the deterministic rules over a profile's current medications and
   * persists a fresh, immutable evaluation (docs/09). Triggered on
   * medication add/restart and allergy add (docs/22 scope for this pass).
   */
  async evaluate(profileId: string, trigger: string): Promise<{ evaluationId: string; findingCount: number }> {
    const medications = await this.prisma.patientMedication.findMany({
      where: { patientProfileId: profileId, status: "current", deletedAt: null },
      include: {
        product: { include: { classifications: true, ingredients: { include: { ingredient: true } } } },
        instructions: { orderBy: { createdAt: "asc" } },
        schedule: true,
        // P2-3: the prescription record (and its doctor) a medicine was
        // recorded against — evidence for the multi-prescription rule.
        prescription: { include: { practitioner: true } },
      },
    });
    const allergies = await this.prisma.patientAllergy.findMany({
      where: { patientProfileId: profileId, active: true, deletedAt: null },
    });

    const toInstruction = (i: (typeof medications)[number]["instructions"][number]): InstructionSnapshot => ({
      id: i.id,
      doseQuantity: Number(i.doseQuantity),
      doseUnit: i.doseUnit,
      frequencyCode: i.frequencyCode,
      pattern: i.pattern,
      originalText: i.originalText,
    });
    const medSnapshots: MedicationSnapshot[] = medications.map((m) => {
      const first = m.instructions[0];
      const current = m.instructions.find((i) => i.supersededAt === null);
      return {
        id: m.id,
        name: m.enteredName,
        normalizationStatus: m.normalizationStatus,
        isCombination: m.product?.isCombination ?? false,
        ingredientIds: m.product?.ingredients.map((i) => i.ingredientId) ?? [],
        ingredientNames: m.product?.ingredients.map((i) => i.ingredient.name) ?? [],
        classIds: m.product?.classifications.map((c) => c.classId) ?? [],
        isPrn: m.isPrn,
        hasActiveSchedule: m.schedule?.status === "active",
        firstInstruction: first ? toInstruction(first) : undefined,
        currentInstruction: current ? toInstruction(current) : undefined,
        prescription:
          m.prescription && m.prescription.deletedAt === null
            ? {
                id: m.prescription.id,
                prescribedAt: m.prescription.prescribedAt ? m.prescription.prescribedAt.toISOString().slice(0, 10) : null,
                practitionerName: m.prescription.practitioner?.displayName ?? null,
              }
            : undefined,
      };
    });
    const allergySnapshots: AllergySnapshot[] = allergies.map((a) => ({
      id: a.id,
      label: a.label,
      allergenIngredientId: a.allergenIngredientId,
    }));

    const findings = evaluateSafety(medSnapshots, allergySnapshots);

    const evaluation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.safetyEvaluation.create({
        data: {
          patientProfileId: profileId,
          trigger,
          appVersion: APP_VERSION,
          inputSnapshot: { medications: medSnapshots, allergies: allergySnapshots } as object,
          completedAt: new Date(),
        },
      });

      for (const f of findings) {
        await tx.safetyFinding.create({
          data: {
            evaluationId: created.id,
            patientProfileId: profileId,
            category: f.category,
            severity: f.severity,
            medicationIds: f.medicationIds,
            ruleKey: f.ruleKey,
            ruleVersion: f.ruleVersion,
            sourceName: f.sourceName,
            explanationKey: f.explanationKey,
            detail: f.detail as object,
          },
        });
      }

      await writeAudit(tx, {
        action: "safety.evaluation_completed",
        actorType: "system",
        entityType: "safety_evaluation",
        entityId: created.id,
        patientProfileId: profileId,
        context: { trigger, findingCount: findings.length },
      });

      return created;
    });

    return { evaluationId: evaluation.id, findingCount: findings.length };
  }

  /**
   * Findings from a profile's most recent evaluation only (docs/13 §current
   * state), each carrying the last action taken on it.
   *
   * `lastAction` exists because `status` alone loses a distinction the
   * patient cares about: both "Mark as resolved" and "This doesn't apply to
   * me" land on `resolved` (see `ACTION_TO_STATUS`), so a finding a patient
   * waved away was being filed under "Resolved and reviewed" — copy that
   * reads as if a professional had looked at it. The status stays as it is
   * (it is what the Gate 3 false-positive count is built on); the action is
   * what the screen words the outcome from.
   */
  async currentFindings(profileId: string, status?: string) {
    const latest = await this.prisma.safetyEvaluation.findFirst({
      where: { patientProfileId: profileId },
      orderBy: { startedAt: "desc" },
    });
    if (!latest) return [];
    const findings = await this.prisma.safetyFinding.findMany({
      where: {
        evaluationId: latest.id,
        ...(status ? { status: status as never } : {}),
      },
      orderBy: [{ severity: "desc" }, { evaluatedAt: "desc" }],
      include: { actions: { orderBy: { occurredAt: "desc" }, take: 1, select: { action: true } } },
    });
    return findings.map(({ actions, ...f }) => ({ ...f, lastAction: actions[0]?.action ?? null }));
  }
}

export type { RawFinding };
