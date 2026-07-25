import { Injectable } from "@nestjs/common";
import { CLINICAL_CONTENT_KINDS, type ClinicalContentKind, type Locale } from "@medpass/domain";
import { PrismaService } from "../../common/prisma.service";

export interface ClinicalContentEntry {
  text: string;
  sourceCitation: string;
  sourceUrl: string | null;
  lastReviewedAt: string | null;
  /** Set only when an approved translation for the caller's locale was shown instead of the English body. */
  locale?: Locale;
}

/** docs/07 screen 19's separate labeled blocks — API DTO uses camelCase, kind enum values are snake_case. */
export const CLINICAL_CONTENT_DTO_KEYS: Record<ClinicalContentKind, string> = {
  education: "education",
  storage: "storage",
  warning_symptoms: "warningSymptoms",
  food_alcohol: "foodAlcohol",
  missed_dose: "missedDose",
};

interface CurrentVersionRow {
  body: string;
  sourceCitation: string;
  sourceUrl: string | null;
  decidedAt: Date | null;
  translations: Array<{ locale: string; body: string }>;
}

const TRANSLATION_WHERE = (locale: Locale) => (locale === "en" ? undefined : { where: { locale, reviewStatus: "approved" as const } });

/**
 * Batched clinical-content lookups shared by `MedicationsService` (all 5
 * kinds, medicine detail) and `TimelineService` (missed_dose only, docs/07
 * screen 26) — one query per caller, never one per medication/dose (no
 * N+1). Two parallel paths, both approved-only:
 *  - `forIngredients`: single-ingredient products.
 *  - `forProducts`: combination products, keyed by the product itself —
 *    never the union of its ingredients' individual content, since that
 *    could imply something never actually reviewed for that combination
 *    (docs/34).
 *
 * Prefers an approved translation for the caller's own locale when one
 * exists; always falls back to the approved English body otherwise — never
 * shows nothing just because a translation hasn't been done yet.
 */
@Injectable()
export class ClinicalContentLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async forIngredients(
    ingredientIds: string[],
    kinds: readonly ClinicalContentKind[] = CLINICAL_CONTENT_KINDS,
    locale: Locale = "en",
  ): Promise<Map<string, Partial<Record<ClinicalContentKind, ClinicalContentEntry>>>> {
    if (ingredientIds.length === 0) return new Map();
    const rows = await this.prisma.clinicalContent.findMany({
      where: { ingredientId: { in: ingredientIds }, kind: { in: kinds as ClinicalContentKind[] }, currentVersionId: { not: null } },
      include: { currentVersion: { include: { translations: TRANSLATION_WHERE(locale) } } },
    });
    return this.toMap(rows.map((r) => ({ key: r.ingredientId!, kind: r.kind, currentVersion: r.currentVersion })), locale);
  }

  async forProducts(
    productIds: string[],
    kinds: readonly ClinicalContentKind[] = CLINICAL_CONTENT_KINDS,
    locale: Locale = "en",
  ): Promise<Map<string, Partial<Record<ClinicalContentKind, ClinicalContentEntry>>>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.prisma.clinicalContent.findMany({
      where: { productId: { in: productIds }, kind: { in: kinds as ClinicalContentKind[] }, currentVersionId: { not: null } },
      include: { currentVersion: { include: { translations: TRANSLATION_WHERE(locale) } } },
    });
    return this.toMap(rows.map((r) => ({ key: r.productId!, kind: r.kind, currentVersion: r.currentVersion })), locale);
  }

  private toMap(
    rows: Array<{ key: string; kind: ClinicalContentKind; currentVersion: CurrentVersionRow | null }>,
    locale: Locale,
  ): Map<string, Partial<Record<ClinicalContentKind, ClinicalContentEntry>>> {
    const map = new Map<string, Partial<Record<ClinicalContentKind, ClinicalContentEntry>>>();
    for (const row of rows) {
      if (!row.currentVersion) continue;
      const translation = row.currentVersion.translations?.[0];
      const byKind = map.get(row.key) ?? {};
      byKind[row.kind] = {
        text: translation?.body ?? row.currentVersion.body,
        sourceCitation: row.currentVersion.sourceCitation,
        sourceUrl: row.currentVersion.sourceUrl,
        lastReviewedAt: row.currentVersion.decidedAt?.toISOString() ?? null,
        ...(translation ? { locale } : {}),
      };
      map.set(row.key, byKind);
    }
    return map;
  }
}
