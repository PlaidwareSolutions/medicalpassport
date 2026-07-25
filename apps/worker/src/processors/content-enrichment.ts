import type { ClinicalContentKind, PrismaClient } from "@medpass/database";
import { fetchClinicalContent, fetchCombinationClinicalContent } from "@medpass/clinical-content";
import { writeAudit } from "@medpass/audit";

export type ContentEnrichmentPayload = { kind: ClinicalContentKind } & ({ ingredientId: string } | { productId: string });

/**
 * Fetches a candidate for one (ingredient, kind) or (product, kind) pair
 * from openFDA/DailyMed and stores it as a draft awaiting human review
 * (docs/13, docs/34 Gate 6/OD-6) — never patient-visible until an admin
 * with `content_approve` approves it. A `null` adapter result (no reliable
 * data found) is a normal, successful outcome: no row is created, and the
 * job still succeeds — this must not be treated as a failure. A thrown
 * adapter error (network/5xx/429) propagates up to the caller's normal
 * failJob/retry/dead-letter handling, exactly like every other processor.
 */
export async function processContentEnrichment(prisma: PrismaClient, payload: ContentEnrichmentPayload, apiKey?: string): Promise<void> {
  if ("ingredientId" in payload) {
    await processIngredientEnrichment(prisma, payload.ingredientId, payload.kind, apiKey);
  } else {
    await processCombinationEnrichment(prisma, payload.productId, payload.kind, apiKey);
  }
}

async function processIngredientEnrichment(prisma: PrismaClient, ingredientId: string, kind: ClinicalContentKind, apiKey?: string): Promise<void> {
  const ingredient = await prisma.medicationIngredient.findUniqueOrThrow({ where: { id: ingredientId } });

  const found = await fetchClinicalContent(kind, ingredient.name, ingredient.synonyms, apiKey);
  if (!found) return; // No reliable data found — nothing to draft, not a failure.

  await prisma.$transaction(async (tx) => {
    const content = await tx.clinicalContent.upsert({
      where: { kind_ingredientId: { kind, ingredientId } },
      create: { kind, ingredientId },
      update: {},
    });
    const version = await tx.clinicalContentVersion.create({
      data: {
        contentId: content.id,
        body: found.text,
        sourceKind: "daily_med",
        sourceCitation: found.sourceCitation,
        sourceUrl: found.sourceUrl,
        lowConfidence: found.lowConfidence,
        reviewStatus: "draft",
      },
    });
    await writeAudit(tx, {
      action: "content.enrichment_drafted",
      actorType: "system",
      entityType: "clinical_content_version",
      entityId: version.id,
      context: { ingredientId, kind, sourceKind: "daily_med", lowConfidence: found.lowConfidence },
    });
  });
}

/**
 * Combination products only — hard-capped at exactly 2 ingredients, the
 * same guard the trigger (`MedicationsService.enqueueContentEnrichment`)
 * already applies before enqueueing, re-checked here against a fresh DB
 * fetch (never trusts the enqueue-time count — the catalog could have
 * changed between enqueue and processing).
 */
async function processCombinationEnrichment(prisma: PrismaClient, productId: string, kind: ClinicalContentKind, apiKey?: string): Promise<void> {
  const product = await prisma.medicationProduct.findUniqueOrThrow({
    where: { id: productId },
    include: { ingredients: { include: { ingredient: true } } },
  });
  if (product.ingredients.length !== 2) return; // Never a silent wrong guess — no data, not a failure.

  const found = await fetchCombinationClinicalContent(
    kind,
    product.ingredients.map((i) => ({ name: i.ingredient.name, synonyms: i.ingredient.synonyms })),
    apiKey,
  );
  if (!found) return;

  await prisma.$transaction(async (tx) => {
    const content = await tx.clinicalContent.upsert({
      where: { kind_productId: { kind, productId } },
      create: { kind, productId },
      update: {},
    });
    const version = await tx.clinicalContentVersion.create({
      data: {
        contentId: content.id,
        body: found.text,
        sourceKind: "daily_med",
        sourceCitation: found.sourceCitation,
        sourceUrl: found.sourceUrl,
        lowConfidence: found.lowConfidence,
        reviewStatus: "draft",
      },
    });
    await writeAudit(tx, {
      action: "content.enrichment_drafted",
      actorType: "system",
      entityType: "clinical_content_version",
      entityId: version.id,
      context: { productId, kind, sourceKind: "daily_med", lowConfidence: found.lowConfidence },
    });
  });
}
