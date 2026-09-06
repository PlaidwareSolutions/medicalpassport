/**
 * Purity guard (docs_v2/09 §7, ADR-V2-001 style, same shape as packages/fhir): this package
 * must never reach the database, Prisma, the filesystem, or the network at runtime.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = join(__dirname, "..");
const SRC = join(PACKAGE_ROOT, "src");

const FORBIDDEN_STRINGS = ["@prisma/client", "@medpass/database", "prisma"];
const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "network client", pattern: /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/ },
  { name: "node http/https/net import", pattern: /from\s+["'](node:)?(http|https|net|dns|tls|child_process)["']/ },
  { name: "node fs import (nothing in src reads files at runtime)", pattern: /from\s+["'](node:)?fs["']/ },
  { name: "workspace package import (pure TS, zod only)", pattern: /from\s+["']@medpass\// },
  { name: "AI SDK import (adapters live in the worker, behind the interfaces)", pattern: /from\s+["'](@anthropic-ai|openai|@google)/ },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

const sources = walk(SRC).map((file) => ({ file: relative(PACKAGE_ROOT, file), text: readFileSync(file, "utf8") }));

describe("purity guard", () => {
  it("finds source files to check", () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  it.each(FORBIDDEN_STRINGS)("src/ never mentions %s", (needle) => {
    const offenders = sources.filter((s) => s.text.toLowerCase().includes(needle.toLowerCase())).map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it.each(FORBIDDEN_PATTERNS)("src/ has no $name", ({ pattern }) => {
    const offenders = sources.filter((s) => pattern.test(s.text)).map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it("package.json depends only on zod at runtime", () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["zod"]);
  });

  it("uses the same zod major as @medpass/validation", () => {
    const own = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    const validation = JSON.parse(readFileSync(join(PACKAGE_ROOT, "..", "validation", "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(own.dependencies.zod).toBe(validation.dependencies.zod);
  });
});
