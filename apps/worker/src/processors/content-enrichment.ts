import type { PrismaClient } from "@medpass/database";
import { fetchIndicationForIngredient } from "@medpass/clinical-content";
import { writeAudit } from "@medpass/audit";

export interface ContentEnrichmentPayload {
  ingredientId: string;
  kind: "education";
}

/**
 * Fetches a candidate "commonly used for" indication for one ingredient
 * from openFDA/DailyMed and stores it as a draft awaiting human review
 * (docs/13, docs/34 Gate 6/OD-6) — never patient-visible until an admin
 * with `content_approve` approves it. A `null` adapter result (no reliable
 * data found) is a normal, successful outcome: no row is created, and the
 * job still succeeds — this must not be treated as a failure. A thrown
 * adapter error (network/5xx/429) propagates up to the caller's normal
 * failJob/retry/dead-letter handling, exactly like every other processor.
 */
export async function processContentEnrichment(prisma: PrismaClient, payload: ContentEnrichmentPayload, apiKey?: string): Promise<void> {
  const { ingredientId, kind } = payload;

  const ingredient = await prisma.medicationIngredient.findUniqueOrThrow({ where: { id: ingredientId } });

  const indication = await fetchIndicationForIngredient(ingredient.name, ingredient.synonyms, apiKey);
  if (!indication) return; // No reliable data found — nothing to draft, not a failure.

  await prisma.$transaction(async (tx) => {
    const content = await tx.clinicalContent.upsert({
      where: { kind_ingredientId: { kind, ingredientId } },
      create: { kind, ingredientId },
      update: {},
    });
    const version = await tx.clinicalContentVersion.create({
      data: {
        contentId: content.id,
        body: indication.text,
        sourceKind: "daily_med",
        sourceCitation: indication.sourceCitation,
        sourceUrl: indication.sourceUrl,
        reviewStatus: "draft",
      },
    });
    await writeAudit(tx, {
      action: "content.enrichment_drafted",
      actorType: "system",
      entityType: "clinical_content_version",
      entityId: version.id,
      context: { ingredientId, kind, sourceKind: "daily_med" },
    });
  });
}
