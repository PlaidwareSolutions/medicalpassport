/**
 * CLI wrapper for V1 manual account erasure (Session 12.5 §8).
 *
 * Operational tool — NOT wired into any HTTP route or the app runtime. Run it
 * only after the privacy SOP's identity verification has completed
 * (docs/landing-page/retention-and-erasure.md).
 *
 * Safety:
 *   - dry run is the DEFAULT; deletion requires an explicit `--execute`;
 *   - in production, `--execute` additionally requires `--i-understand-production`;
 *   - the plan prints counts only — never medicine names or health content.
 *
 * Usage:
 *   node dist/ops/erase-account.cli.js --phone +91XXXXXXXXXX
 *   node dist/ops/erase-account.cli.js --user-id <uuid> --execute [--i-understand-production] [--note "ticket #123"]
 */
import { PrismaClient } from "@medpass/database";
import { AccountErasure } from "./account-erasure";
import { phoneDigest } from "../common/crypto";
import { env } from "../common/env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

async function main() {
  const cfg = env();
  const userIdArg = arg("--user-id");
  const phoneArg = arg("--phone");
  const execute = has("--execute");
  const prodAck = has("--i-understand-production");

  if (!userIdArg && !phoneArg) {
    console.error("usage: --user-id <uuid> | --phone <e164>  [--execute] [--i-understand-production] [--note <text>]");
    process.exit(2);
  }
  if (execute && cfg.NODE_ENV === "production" && !prodAck) {
    console.error("Refusing to --execute in production without --i-understand-production.");
    process.exit(3);
  }

  const prisma = new PrismaClient();
  try {
    let userId = userIdArg;
    if (!userId && phoneArg) {
      const u = await prisma.user.findUnique({ where: { phoneDigest: phoneDigest(phoneArg) }, select: { id: true } });
      if (!u) {
        console.error("No account found for that phone number.");
        process.exit(4);
      }
      userId = u.id;
    }

    const erasure = new AccountErasure(prisma);
    const plan = await erasure.plan(userId!);
    if (!plan.found) {
      console.error("No such user.");
      process.exit(4);
    }

    console.log(`\nERASURE PLAN (dry run) — user ${plan.userId} [env=${cfg.NODE_ENV}]`);
    console.table(plan.counts);
    console.log(`private objects to delete: ${plan.storedObjects.length}`);

    if (!execute) {
      console.log("\nDry run only. Re-run with --execute to erase (irreversible).");
      return;
    }

    console.log("\nEXECUTING erasure (irreversible)…");
    const res = await erasure.execute(userId!, { operatorNote: arg("--note") });
    console.log(`ERASED. private objects deleted=${res.objectsDeleted}, errors=${res.objectDeleteErrors}`);
    console.log("A minimal 'account.erased' audit record (counts only) was retained.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
