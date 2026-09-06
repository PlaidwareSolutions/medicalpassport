/**
 * ESLint-free purity guard (ADR-V2-001 verification): this package must never reach the
 * database, Prisma, or the network, and IG folders must not import each other (ADR-V2-003).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = join(__dirname, "..");
const SRC = join(PACKAGE_ROOT, "src");

const FORBIDDEN_STRINGS = ["@prisma/client", "@medpass/database"];
const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "network client", pattern: /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/ },
  { name: "node http/https/net import", pattern: /from\s+["'](node:)?(http|https|net|dns|tls)["']/ },
  { name: "node fs import (nothing in src reads files at runtime)", pattern: /from\s+["'](node:)?fs["']/ },
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
    const offenders = sources.filter((s) => s.text.includes(needle)).map((s) => s.file);
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

  it("IG version folders never import each other", () => {
    const folders = readdirSync(join(SRC, "ig"));
    expect(folders.length).toBeGreaterThanOrEqual(2);
    const offenders = sources
      .filter((s) => /^src[\\/]ig[\\/]/.test(s.file))
      .filter((s) => {
        const own = s.file.split(/[\\/]/)[2];
        return folders.some((other) => other !== own && s.text.includes(`/${other}/`));
      })
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it("only version-mapper.ts imports from src/ig", () => {
    const offenders = sources
      .filter((s) => !/^src[\\/]ig[\\/]/.test(s.file) && s.file !== join("src", "version-mapper.ts"))
      .filter((s) => /from\s+["'][^"']*\/ig\//.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});
