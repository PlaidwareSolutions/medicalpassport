/**
 * One-time bootstrap for the very first AdminUser (docs/18 admin auth) —
 * there's no "invite" flow that could create one otherwise. Safe to leave
 * in the repo permanently: refuses to run once any AdminUser exists, so
 * it's never a live attack surface the way an endpoint would be.
 *
 * Duplicates ~10 lines of apps/api's hashPassword algorithm rather than
 * importing it — packages/database cannot depend on apps/api (packages
 * never depend on apps), and this is a one-shot bootstrap script, not a
 * runtime code path that could drift silently.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function hashPassword(pepper: string, password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pepper + password, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

async function main() {
  const existing = await prisma.adminUser.count();
  if (existing > 0) {
    console.log(`Refusing to run: ${existing} AdminUser row(s) already exist.`);
    return;
  }

  const email = (process.env.ADMIN_BOOTSTRAP_EMAIL ?? "kfnawaz@gmail.com").trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const pepper = process.env.ADMIN_PASSWORD_PEPPER;
  if (!password) throw new Error("ADMIN_BOOTSTRAP_PASSWORD is required");
  if (!pepper) throw new Error("ADMIN_PASSWORD_PEPPER is required");

  const admin = await prisma.adminUser.create({
    data: {
      email,
      passwordHash: hashPassword(pepper, password),
      duties: ["super_admin"],
    },
  });

  console.log(`Created first admin user: ${admin.email} (${admin.id}), duties: super_admin.`);
  console.log("Sign in and enroll TOTP MFA through the admin-web UI to finish setup.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
