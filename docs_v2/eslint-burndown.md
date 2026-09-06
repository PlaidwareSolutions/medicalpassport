# ESLint findings burn-down

Phase 0 ticket 0.7 (ADR-V2-014, [13 §7](13-verification-and-quality.md)). The
gate is `pnpm lint`, run in CI after `pnpm typecheck`. **Errors fail the build;
warnings do not.** This file is the list of warnings we accepted rather than
fixed, and what would have to happen to clear each one. A warning that is not
on this list is a regression, not a baseline.

Established 2026-09-06. Zero errors across all 32 workspace packages at that
point, so there is no error baseline to burn down — only the warnings below.

## Why the config is shaped the way it is

Type-aware linting is deliberately **off**. `projectService` would parse every
tsconfig on every run, and `pnpm typecheck` already runs in CI and catches
everything the type-aware rules would. Lint here is for what the compiler
cannot see: accessibility, import hygiene, and a handful of correctness rules.

Five rules from the recommended sets are switched off in `eslint.config.mjs`,
each with its reason in a comment there. Summarised:

| Rule | Why it is off |
|---|---|
| `import/no-duplicates` | Fights `consistent-type-imports`, which asks for a separate `import type` line from the same module. That split is the repo convention. |
| `no-useless-escape` | Fires on `[:.\-]` in the prescription-parsing regexes, where escaping inside a character class is defensive: an unescaped `-` that later gains a neighbour silently becomes a range. |
| `no-unmodified-loop-condition` | Cannot see asynchronous mutation, so it calls the worker's `while (!shuttingDown)` drain loop a bug when the flag is set by a SIGTERM handler. |
| `jsx-a11y/no-redundant-roles` | The screens set `role="list"` on purpose: removing bullets with `list-style: none` also drops list semantics in Safari/VoiceOver. |
| `jsx-a11y/no-autofocus`, `jsx-a11y/label-has-associated-control` | The design system draws its own controls; both are covered by the axe suite, which is the actual release gate. |

## Warnings accepted, with the work that would clear them

| Count | Rule | Where | To clear |
|---|---|---|---|
| ~216 | `@typescript-eslint/no-explicit-any` | mostly `apps/api` | `any` is sometimes the honest type at a boundary (Prisma `Json`, inbound FHIR). Worth narrowing opportunistically; not worth a sweep. The count is the signal — it should fall, never rise. |
| 2 | `jsx-a11y/media-has-caption` | `apps/marketing-web` `AudioSample.tsx`, `CommercialFilm.tsx` | **Real accessibility debt.** The voice samples and the film have no caption files. Needs caption tracks authored per locale, which is part of the P16 locale work. Kept as a warning so it stays visible rather than silenced. |
| 3 | `@next/next/no-img-element` | documents screens, `PageCrop.tsx` | Deliberate and disabled per line: routing a presigned document URL through Next's image optimiser would proxy PHI through it. These will not be cleared. |
| a few | `@typescript-eslint/consistent-type-imports` | `apps/worker` | `import()` type annotations in two processors. Cosmetic; clear when those files are next touched. |
| a few | `import/order`, unused `eslint-disable` directives | scattered | Auto-fixable with `eslint . --fix`. Left alone rather than sweeping every file while three parallel workstreams were mid-edit. |

## Adding a package

Add `"lint": "eslint ."` to its `package.json`. The flat config at the repo
root is found by walking up, so nothing else is needed.
