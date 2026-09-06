/**
 * Test-only helpers that make the caregiver matrix "generated" rather than
 * hand-maintained (docs_v2/03 §6):
 *
 *  - readPrismaCaregiverScopes(): the CaregiverScope enum straight from
 *    schema.prisma, so the test never trusts a copy of the enum.
 *  - collectApiProfileActions(): every action literal apps/api passes to
 *    ProfileAccessService.require / requireForProfile, found by scanning the
 *    source. A call site whose action is not a literal is resolved through
 *    the local `const x = fn(...)` that produced it: `fn` may live in the
 *    same file or behind a named relative import, and its actions are the
 *    `return "..."` literals in its body or the `action: "..."` entries of
 *    a top-level table it reads. A function whose declared return type is
 *    `ProfileAction` is accepted even without literals (TypeScript already
 *    bounds what it can return); anything else is reported as unresolved so
 *    a new dynamic call site cannot silently escape the matrix.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const PRISMA_SCHEMA_PATH = join(REPO_ROOT, "packages", "database", "prisma", "schema.prisma");
export const API_SRC_DIR = join(REPO_ROOT, "apps", "api", "src");

/** The file that owns the only `decideProfileAccess` call in apps/api. */
export const ACCESS_SERVICE_FILE = "common/profile-access.service.ts";

export function readPrismaCaregiverScopes(schemaPath = PRISMA_SCHEMA_PATH): string[] {
  const schema = readFileSync(schemaPath, "utf8");
  const match = /enum\s+CaregiverScope\s*\{([^}]*)\}/.exec(schema);
  if (!match) throw new Error(`enum CaregiverScope not found in ${schemaPath}`);
  return match[1]!
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("@@"));
}

export interface ApiActionCallSite {
  file: string;
  line: number;
  /** Literal actions this call site can request. */
  actions: string[];
  /** How the actions were established. */
  resolvedBy: "literal" | "function" | "type" | "unresolved";
  /** Set when the argument was not a literal and could not be resolved. */
  unresolved?: string;
}

export interface ApiActionScan {
  callSites: ApiActionCallSite[];
  /** Distinct action literals across all resolved call sites. */
  actions: string[];
  /** Files (relative to apps/api/src) that call decideProfileAccess directly. */
  directDeciderCallers: string[];
}

const SNAKE = "[a-z]+(?:_[a-z]+)+";
const ACTION_LITERAL = new RegExp(`"(${SNAKE})"`, "g");
const REQUIRE_CALL = /\.require(?:ForProfile)?\(/g;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.ts$/.test(entry) && !/\.(spec|test)\.ts$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out.sort();
}

/** Text between `openIndex` (just after an opener) and its matching closer. */
function balanced(source: string, openIndex: number, open: string, close: string): string {
  let depth = 1;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return source.slice(openIndex, i);
  }
  return source.slice(openIndex);
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/** Split a top-level argument list on commas (ignores nesting/strings). */
function splitArgs(text: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      current += ch;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      current += ch;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      current += ch;
    } else if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

/** True when no block that was open at `from` has been closed by `to`. */
function stillInScope(source: string, from: number, to: number): boolean {
  let depth = 0;
  for (let i = from; i < to; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth < 0) return false;
  }
  return true;
}

/** Follow `import { fn } from "./x"` to the module's absolute path, if relative. */
function importedModulePath(source: string, filePath: string, name: string): string | undefined {
  for (const m of source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'](\.[^"']*)["']/g)) {
    const names = m[1]!.split(",").map((n) => n.trim().split(/\s+as\s+/).pop()!.trim());
    if (!names.includes(name)) continue;
    const spec = m[2]!.replace(/\.js$/, "");
    const base = join(dirname(filePath), spec);
    for (const candidate of [`${base}.ts`, join(base, "index.ts")]) if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

interface FunctionActions {
  literals: string[];
  /** Declared return type names ProfileAction. */
  typed: boolean;
}

/** Locate `function fn(` / `const fn = (` in `source` and harvest its actions. */
function actionsOfFunction(source: string, fnName: string): FunctionActions | undefined {
  const decl =
    new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${fnName}\\s*\\(`).exec(source) ??
    new RegExp(`(?:export\\s+)?const\\s+${fnName}\\s*=\\s*(?:async\\s*)?\\(`).exec(source);
  if (!decl) return undefined;
  const bodyOpen = source.indexOf("{", decl.index);
  if (bodyOpen < 0) return undefined;
  const header = source.slice(decl.index, bodyOpen);
  const body = balanced(source, bodyOpen + 1, "{", "}");
  const typed = /\bProfileAction\b/.test(header);

  const literals = [...body.matchAll(new RegExp(`return\\s+"(${SNAKE})"`, "g"))].map((m) => m[1]!);
  if (literals.length > 0) return { literals: [...new Set(literals)], typed };

  // Table shape: the body reads a top-level const whose entries carry `action: "..."`.
  const fromTables: string[] = [];
  for (const c of source.matchAll(/(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*/g)) {
    const name = c[1]!;
    if (name === fnName || !new RegExp(`\\b${name}\\b`).test(body)) continue;
    const initStart = c.index! + c[0].length;
    const opener = source[initStart];
    const init =
      opener === "[" ? balanced(source, initStart + 1, "[", "]")
      : opener === "{" ? balanced(source, initStart + 1, "{", "}")
      : source.slice(initStart, source.indexOf(";", initStart));
    for (const m of init.matchAll(new RegExp(`\\baction\\s*:\\s*"(${SNAKE})"`, "g"))) fromTables.push(m[1]!);
  }
  return { literals: [...new Set(fromTables)], typed };
}

/**
 * Resolve an identifier argument: find the nearest preceding
 * `const <ident> = <fn>(` that is still in scope at the call (no block closes
 * between the assignment and the call), then harvest `fn`'s actions from
 * this file or the relative module it is imported from. A whole-file lookup
 * would let a dynamic call site borrow an unrelated function's same-named
 * local, so scope is checked.
 */
function resolveIdentifier(source: string, filePath: string, ident: string, callIndex: number): FunctionActions | undefined {
  const assignRe = new RegExp(`(?:const|let)\\s+${ident}\\s*=\\s*([A-Za-z_$][\\w$]*)\\(`, "g");
  let assign: RegExpExecArray | undefined;
  for (const m of source.slice(0, callIndex).matchAll(assignRe)) assign = m;
  if (!assign) return undefined;
  if (!stillInScope(source, assign.index + assign[0].length, callIndex)) return undefined;
  const fnName = assign[1]!;

  const local = actionsOfFunction(source, fnName);
  if (local) return local;
  const modulePath = importedModulePath(source, filePath, fnName);
  return modulePath ? actionsOfFunction(readFileSync(modulePath, "utf8"), fnName) : undefined;
}

export function collectApiProfileActions(srcDir = API_SRC_DIR): ApiActionScan {
  const callSites: ApiActionCallSite[] = [];
  const directDeciderCallers: string[] = [];

  for (const file of listSourceFiles(srcDir)) {
    const rel = relative(srcDir, file).replace(/\\/g, "/");
    const source = readFileSync(file, "utf8");
    if (/\bdecideProfileAccess\(/.test(source)) directDeciderCallers.push(rel);
    // The service itself forwards `action` from require() to
    // requireForProfile(); that is plumbing, not a request for an action.
    if (rel === ACCESS_SERVICE_FILE) continue;

    for (const call of source.matchAll(REQUIRE_CALL)) {
      // Prose mentions in comments ("call after `ProfileAccessService.require()`")
      // are not call sites; skip a match whose line is a `//` or `*` comment.
      const lineStart = source.lastIndexOf("\n", call.index!) + 1;
      const linePrefix = source.slice(lineStart, call.index!).trimStart();
      if (linePrefix.startsWith("//") || linePrefix.startsWith("*") || linePrefix.startsWith("/*")) continue;
      const argsText = balanced(source, call.index! + call[0].length, "(", ")");
      const line = lineOf(source, call.index!);
      const args = splitArgs(argsText);
      // require(req, action) → index 1; requireForProfile(userId, profileId, action, ...) → index 2
      const actionArg = call[0].includes("ForProfile") ? args[2] : args[1];
      const literals = actionArg ? [...actionArg.matchAll(ACTION_LITERAL)].map((m) => m[1]!) : [];
      if (literals.length > 0) {
        callSites.push({ file: rel, line, actions: [...new Set(literals)], resolvedBy: "literal" });
        continue;
      }
      const ident = actionArg && /^[A-Za-z_$][\w$]*$/.test(actionArg) ? actionArg : undefined;
      const resolved = ident ? resolveIdentifier(source, file, ident, call.index!) : undefined;
      if (resolved && resolved.literals.length > 0) {
        callSites.push({ file: rel, line, actions: resolved.literals, resolvedBy: "function" });
      } else if (resolved?.typed) {
        callSites.push({ file: rel, line, actions: [], resolvedBy: "type" });
      } else {
        callSites.push({
          file: rel,
          line,
          actions: [],
          resolvedBy: "unresolved",
          unresolved: actionArg ?? "(no action argument)",
        });
      }
    }
  }

  const actions = [...new Set(callSites.flatMap((c) => c.actions))].sort();
  return { callSites, actions, directDeciderCallers };
}
