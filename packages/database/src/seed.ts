/**
 * Development seed: a small, clearly-marked SAMPLE medication catalog.
 *
 * Status per docs/22: Mocked / Requires clinical validation. This data exists
 * so the product can be developed and demonstrated. It is NOT clinically
 * reviewed and must never ship to production as approved content (docs/11).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface SeedProduct {
  brand: string;
  manufacturer: string;
  generic: string;
  form: string;
  route: string;
  strengthLabel: string;
  combination?: boolean;
  ingredients: Array<{ name: string; strength: number; unit: string }>;
  classes: string[];
}

const PRODUCTS: SeedProduct[] = [
  {
    brand: "Glycomet",
    manufacturer: "USV",
    generic: "Metformin",
    form: "tablet",
    route: "oral",
    strengthLabel: "500 mg",
    ingredients: [{ name: "Metformin", strength: 500, unit: "mg" }],
    classes: ["Biguanide antidiabetic"],
  },
  {
    brand: "Glyciphage",
    manufacturer: "Franco-Indian",
    generic: "Metformin",
    form: "tablet",
    route: "oral",
    strengthLabel: "500 mg",
    ingredients: [{ name: "Metformin", strength: 500, unit: "mg" }],
    classes: ["Biguanide antidiabetic"],
  },
  {
    brand: "Amlong",
    manufacturer: "Micro Labs",
    generic: "Amlodipine",
    form: "tablet",
    route: "oral",
    strengthLabel: "5 mg",
    ingredients: [{ name: "Amlodipine", strength: 5, unit: "mg" }],
    classes: ["Calcium channel blocker"],
  },
  {
    brand: "Telma",
    manufacturer: "Glenmark",
    generic: "Telmisartan",
    form: "tablet",
    route: "oral",
    strengthLabel: "40 mg",
    ingredients: [{ name: "Telmisartan", strength: 40, unit: "mg" }],
    classes: ["Angiotensin receptor blocker"],
  },
  {
    // Fixed-dose combination so partial-duplication scenarios are testable.
    brand: "Telma-AM",
    manufacturer: "Glenmark",
    generic: "Telmisartan + Amlodipine",
    form: "tablet",
    route: "oral",
    strengthLabel: "40 mg / 5 mg",
    combination: true,
    ingredients: [
      { name: "Telmisartan", strength: 40, unit: "mg" },
      { name: "Amlodipine", strength: 5, unit: "mg" },
    ],
    classes: ["Angiotensin receptor blocker", "Calcium channel blocker"],
  },
  {
    brand: "Thyronorm",
    manufacturer: "Abbott",
    generic: "Levothyroxine",
    form: "tablet",
    route: "oral",
    strengthLabel: "50 mcg",
    ingredients: [{ name: "Levothyroxine", strength: 50, unit: "mcg" }],
    classes: ["Thyroid hormone"],
  },
  {
    brand: "Dolo 650",
    manufacturer: "Micro Labs",
    generic: "Paracetamol",
    form: "tablet",
    route: "oral",
    strengthLabel: "650 mg",
    ingredients: [{ name: "Paracetamol", strength: 650, unit: "mg" }],
    classes: ["Analgesic-antipyretic"],
  },
  {
    brand: "Pan 40",
    manufacturer: "Alkem",
    generic: "Pantoprazole",
    form: "tablet",
    route: "oral",
    strengthLabel: "40 mg",
    ingredients: [{ name: "Pantoprazole", strength: 40, unit: "mg" }],
    classes: ["Proton pump inhibitor"],
  },
  {
    // Common allergen ingredient, seeded so the drug-allergy safety demo
    // (add allergy → add matching medicine) has something real to match.
    brand: "Novamox",
    manufacturer: "Cipla",
    generic: "Amoxicillin",
    form: "capsule",
    route: "oral",
    strengthLabel: "500 mg",
    ingredients: [{ name: "Amoxicillin", strength: 500, unit: "mg" }],
    classes: ["Penicillin antibiotic"],
  },
];

async function main() {
  for (const p of PRODUCTS) {
    const manufacturer = await prisma.manufacturer.upsert({
      where: { name: p.manufacturer },
      update: {},
      create: { name: p.manufacturer },
    });
    const form = await prisma.dosageForm.upsert({
      where: { name: p.form },
      update: {},
      create: { name: p.form },
    });
    const route = await prisma.administrationRoute.upsert({
      where: { name: p.route },
      update: {},
      create: { name: p.route },
    });

    let brand = await prisma.medicationBrand.findFirst({ where: { name: p.brand } });
    if (!brand) {
      brand = await prisma.medicationBrand.create({
        data: { name: p.brand, manufacturerId: manufacturer.id },
      });
    }

    const existing = await prisma.medicationProduct.findFirst({
      where: { brandId: brand.id, strengthLabel: p.strengthLabel },
    });
    if (existing) continue;

    const product = await prisma.medicationProduct.create({
      data: {
        brandId: brand.id,
        genericName: p.generic,
        dosageFormId: form.id,
        routeId: route.id,
        isCombination: p.combination ?? false,
        strengthLabel: p.strengthLabel,
        sourceName: "SAMPLE-DEV-SEED",
        sourceVersion: "0 (not clinically reviewed)",
      },
    });

    for (const ing of p.ingredients) {
      const ingredient = await prisma.medicationIngredient.upsert({
        where: { name: ing.name },
        update: {},
        create: { name: ing.name },
      });
      await prisma.medicationProductIngredient.create({
        data: {
          productId: product.id,
          ingredientId: ingredient.id,
          strengthValue: ing.strength,
          strengthUnit: ing.unit,
        },
      });
    }

    for (const cls of p.classes) {
      const klass = await prisma.therapeuticClass.upsert({
        where: { name: cls },
        update: {},
        create: { name: cls },
      });
      await prisma.productClassification.create({
        data: { productId: product.id, classId: klass.id, source: "SAMPLE-DEV-SEED" },
      });
    }
  }

  // Common lay term so an allergy labeled "Penicillin" auto-links to the
  // Amoxicillin ingredient (docs/07 screen 30) via exact/synonym match.
  await prisma.medicationIngredient.updateMany({
    where: { name: "Amoxicillin" },
    data: { synonyms: ["Penicillin", "Amoxil"] },
  });

  // eslint-disable-next-line no-console
  console.log(`Seeded ${PRODUCTS.length} sample products (SAMPLE-DEV-SEED, not clinically reviewed).`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
