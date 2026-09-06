/**
 * Guards the scanner that feeds matrix.test.ts: if it silently stopped
 * seeing a call-site shape, the matrix would look exhaustive while missing
 * real actions. Fixtures mirror the shapes present in apps/api today plus
 * the ones it had recently (in-file `return "..." as const`), so a refactor
 * between them cannot break the scan.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectApiProfileActions, readPrismaCaregiverScopes } from "./api-actions.js";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "medpass-api-actions-"));
  mkdirSync(join(root, "common"), { recursive: true });
  mkdirSync(join(root, "modules", "a"), { recursive: true });
  mkdirSync(join(root, "modules", "b"), { recursive: true });
  mkdirSync(join(root, "modules", "c"), { recursive: true });

  writeFileSync(
    join(root, "common", "profile-access.service.ts"),
    `import { decideProfileAccess } from "@medpass/authorization";
export class ProfileAccessService {
  async require(req, action) { return this.requireForProfile(req.userId, req.profileId, action, req.correlationId); }
  async requireForProfile(userId, profileId, action, correlationId) { return decideProfileAccess({}, action); }
}
`,
  );

  // Literal shapes: plain, ternary, multi-line.
  writeFileSync(
    join(root, "modules", "a", "a.controller.ts"),
    `export class AController {
  async list(req) { await this.access.require(req, "view_medications"); }
  async upload(req, ownedByRecord) {
    await this.access.require(req, ownedByRecord ? "edit_profile" : "add_medications");
  }
  async multi(req) {
    await this.access.require(
      req,
      "share_records",
    );
  }
}
`,
  );

  // Dynamic shapes: in-file function returning literals; an out-of-scope
  // same-named local that must NOT be borrowed; a typed-only function.
  writeFileSync(
    join(root, "modules", "b", "b.service.ts"),
    `import type { ProfileAction } from "@medpass/authorization";
function requiredActionFor(entity: string, operation: string) {
  if (entity === "dose_event") return "record_doses" as const;
  if (entity === "patient_medication") return "edit_medications" as const;
  return undefined;
}
function opaque(kind: string): ProfileAction | undefined {
  return lookupSomewhereElse(kind);
}
export class BService {
  async applyOne(userId, mutation, correlationId) {
    const action = requiredActionFor(mutation.entity, mutation.operation);
    await this.access.requireForProfile(userId, mutation.profileId, action, correlationId);
  }
  async poll(userId, profileId) {
    await this.access.requireForProfile(userId, profileId, "view_schedule");
  }
  async mystery(req, action) {
    await this.access.require(req, action);
  }
  async typedOnly(req, kind) {
    const action = opaque(kind);
    await this.access.require(req, action);
  }
}
`,
  );

  // Table shape behind a named relative import (apps/api's sync-dispatch).
  writeFileSync(
    join(root, "modules", "c", "c-dispatch.ts"),
    `import type { ProfileAction } from "@medpass/authorization";
export const DISPATCHED = [
  { entity: "dose_event", operation: "create", action: "record_doses" },
  { entity: "patient_medication", operation: "create", action: "add_medications" },
] as const satisfies readonly { entity: string; operation: string; action: ProfileAction }[];
export function requiredActionFor(entity: string, operation: string): ProfileAction | undefined {
  return DISPATCHED.find((d) => d.entity === entity && d.operation === operation)?.action;
}
`,
  );
  writeFileSync(
    join(root, "modules", "c", "c.service.ts"),
    `import { requiredActionFor } from "./c-dispatch";
export class CService {
  async applyOne(userId, mutation, correlationId) {
    const action = requiredActionFor(mutation.entity, mutation.operation);
    if (!action) return { kind: "invalid" };
    try {
      await this.access.requireForProfile(userId, mutation.profileId, action, correlationId);
    } catch {
      return { kind: "permission_revoked" };
    }
  }
}
`,
  );

  // Test files are ignored so fake literals in specs can't pollute the matrix.
  writeFileSync(join(root, "modules", "b", "b.spec.ts"), `access.require(req, "not_a_real_action");`);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("collectApiProfileActions", () => {
  it("finds literal, ternary and multi-line call sites", () => {
    const byLine = Object.fromEntries(collectApiProfileActions(root).callSites.map((c) => [`${c.file}:${c.line}`, c]));
    expect(byLine["modules/a/a.controller.ts:2"]).toMatchObject({ actions: ["view_medications"], resolvedBy: "literal" });
    expect(byLine["modules/a/a.controller.ts:4"]).toMatchObject({ actions: ["edit_profile", "add_medications"], resolvedBy: "literal" });
    expect(byLine["modules/a/a.controller.ts:7"]).toMatchObject({ actions: ["share_records"], resolvedBy: "literal" });
    expect(byLine["modules/b/b.service.ts:16"]).toMatchObject({ actions: ["view_schedule"], resolvedBy: "literal" });
  });

  it("resolves an identifier through an in-file function's return literals", () => {
    const site = collectApiProfileActions(root).callSites.find((c) => c.file === "modules/b/b.service.ts" && c.line === 13);
    expect(site).toMatchObject({ actions: ["record_doses", "edit_medications"], resolvedBy: "function" });
  });

  it("resolves an identifier through a relative import to a table of `action:` entries", () => {
    const site = collectApiProfileActions(root).callSites.find((c) => c.file === "modules/c/c.service.ts");
    expect(site).toMatchObject({ line: 7, actions: ["record_doses", "add_medications"], resolvedBy: "function" });
  });

  it("accepts a function typed as returning ProfileAction even without literals", () => {
    const site = collectApiProfileActions(root).callSites.find((c) => c.file === "modules/b/b.service.ts" && c.line === 23);
    expect(site).toMatchObject({ actions: [], resolvedBy: "type" });
    expect(site?.unresolved).toBeUndefined();
  });

  it("flags an identifier with no in-scope producer (does not borrow another function's local)", () => {
    const unresolved = collectApiProfileActions(root).callSites.filter((c) => c.unresolved);
    expect(unresolved).toEqual([
      { file: "modules/b/b.service.ts", line: 19, actions: [], resolvedBy: "unresolved", unresolved: "action" },
    ]);
  });

  it("aggregates the distinct action set across all resolved sites", () => {
    expect(collectApiProfileActions(root).actions).toEqual(
      ["add_medications", "edit_medications", "edit_profile", "record_doses", "share_records", "view_medications", "view_schedule"].sort(),
    );
  });

  it("ignores the access service's own forwarding call but records it as the decider caller", () => {
    const scan = collectApiProfileActions(root);
    expect(scan.callSites.some((c) => c.file === "common/profile-access.service.ts")).toBe(false);
    expect(scan.directDeciderCallers).toEqual(["common/profile-access.service.ts"]);
  });

  it("does not read spec/test files", () => {
    expect(collectApiProfileActions(root).actions).not.toContain("not_a_real_action");
  });
});

describe("readPrismaCaregiverScopes", () => {
  it("parses the enum body, ignoring comments and blank lines", () => {
    const schema = join(root, "schema.prisma");
    writeFileSync(
      schema,
      `enum Other {\n  x\n}\n\nenum CaregiverScope {\n  view_medications // read\n\n  full_management\n  @@map("caregiver_scope")\n}\n`,
    );
    expect(readPrismaCaregiverScopes(schema)).toEqual(["view_medications", "full_management"]);
  });

  it("throws when the enum is absent rather than returning an empty matrix input", () => {
    const schema = join(root, "empty.prisma");
    writeFileSync(schema, "model Foo { id String @id }\n");
    expect(() => readPrismaCaregiverScopes(schema)).toThrow(/CaregiverScope/);
  });
});
