import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { PrismaService } from "../../common/prisma.service";
import { evaluateSafety, type AllergySnapshot, type MedicationSnapshot, type RawFinding } from "./safety-rules";

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
      },
    });
    const allergies = await this.prisma.patientAllergy.findMany({
      where: { patientProfileId: profileId, active: true, deletedAt: null },
    });

    const medSnapshots: MedicationSnapshot[] = medications.map((m) => ({
      id: m.id,
      name: m.enteredName,
      normalizationStatus: m.normalizationStatus,
      isCombination: m.product?.isCombination ?? false,
      ingredientIds: m.product?.ingredients.map((i) => i.ingredientId) ?? [],
      ingredientNames: m.product?.ingredients.map((i) => i.ingredient.name) ?? [],
      classIds: m.product?.classifications.map((c) => c.classId) ?? [],
    }));
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

  /** Findings from a profile's most recent evaluation only (docs/13 §current state). */
  async currentFindings(profileId: string, status?: string) {
    const latest = await this.prisma.safetyEvaluation.findFirst({
      where: { patientProfileId: profileId },
      orderBy: { startedAt: "desc" },
    });
    if (!latest) return [];
    return this.prisma.safetyFinding.findMany({
      where: {
        evaluationId: latest.id,
        ...(status ? { status: status as never } : {}),
      },
      orderBy: [{ severity: "desc" }, { evaluatedAt: "desc" }],
    });
  }
}

export type { RawFinding };
