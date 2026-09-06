// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";
import importPlugin from "eslint-plugin-import";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";

/**
 * Shared flat config for the whole monorepo (ADR-V2-014, docs_v2/13 §7 item 1,
 * Phase 0 ticket 0.7). Every package's `lint` script runs `eslint .` and picks
 * this file up by walking to the workspace root, so a new package needs a
 * script and nothing else.
 *
 * Why type-aware linting is NOT on: `projectService` would parse every
 * tsconfig on every run, which on this repo costs more than `pnpm typecheck`
 * — and typecheck already runs in CI and catches everything the type-aware
 * rules would. Lint here is for the things the compiler cannot see:
 * accessibility, import hygiene, and a handful of correctness rules.
 *
 * The rules below are the ones that found real defects when this was first
 * run. Anything that fired only on style was left off rather than baselined,
 * so a warning in this repo always means something worth reading.
 */

const ignores = [
  "**/dist/**",
  "**/.next/**",
  "**/.next-*/**",
  "**/node_modules/**",
  "**/coverage/**",
  "**/playwright-report/**",
  "**/test-results/**",
  "**/build/**",
  "**/.turbo/**",
  // `next export` output — minified bundles, not authored source.
  "apps/marketing-web/out/**",
  "packages/database/generated/**",
  "**/*.d.ts",
  // Generated or vendored assets, not authored source.
  "apps/patient-web/public/**",
  "apps/marketing-web/public/**",
];

export default tseslint.config(
  { ignores },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    plugins: { import: importPlugin },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.es2021 },
    },
    settings: {
      "import/resolver": {
        typescript: { alwaysTryTypes: true, project: ["apps/*/tsconfig.json", "packages/*/tsconfig.json"] },
        node: true,
      },
    },
    rules: {
      // An unused variable is usually a half-finished edit. Underscore-prefixed
      // ones are the documented way to say "deliberately ignored".
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
      // `any` is sometimes the honest type at a boundary (Prisma JSON, FHIR
      // parsing), so this warns rather than fails; the count is the signal.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "error",
      "@typescript-eslint/consistent-type-imports": ["warn", { prefer: "type-imports", fixStyle: "separate-type-imports" }],
      // Catches `if (x = 1)`. Left at `except-parens` (the default) so the
      // canonical `while ((m = re.exec(s)) !== null)` loop stays legal — the
      // extra parentheses plus an explicit comparison are exactly how a
      // deliberate assignment is spelled.
      "no-cond-assign": ["error", "except-parens"],
      // Off deliberately. It fires on `[:.\-]` and `[\s(\[]` in the
      // prescription-parsing regexes, where escaping inside a character class
      // is defensive: an unescaped `-` that later gains a neighbour silently
      // becomes a range. Unescaping medical-text parsers to satisfy a
      // cosmetic rule is a worse trade than the rule is worth.
      "no-useless-escape": "off",
      "no-constant-binary-expression": "error",
      "no-self-compare": "error",
      "no-template-curly-in-string": "error",
      // Off: the rule cannot see asynchronous mutation, so it calls every
      // `while (!shuttingDown)` drain loop a bug when the flag is set by a
      // SIGTERM handler. That pattern is how the worker shuts down cleanly.
      "no-unmodified-loop-condition": "off",
      "require-atomic-updates": "off", // too many false positives on awaited upserts
      eqeqeq: ["error", "always", { null: "ignore" }],
      // `import/no-duplicates` is deliberately absent: it flags the separate
      // value and `import type` lines from one module that
      // consistent-type-imports (separate-type-imports) asks for, and this
      // repo uses that split everywhere.
      "import/no-self-import": "error",
      "import/no-cycle": ["warn", { maxDepth: 6, ignoreExternal: true }],
      "import/order": [
        "warn",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          pathGroups: [{ pattern: "@medpass/**", group: "internal", position: "before" }],
          pathGroupsExcludedImportTypes: ["builtin"],
          "newlines-between": "never",
        },
      ],
    },
  },

  // React / Next apps: accessibility is a release gate (docs/33), so these are
  // errors, matching the axe suite rather than sitting below it.
  {
    files: ["apps/{patient-web,admin-web,provider-web,marketing-web}/**/*.{ts,tsx}", "packages/ui-web/**/*.{ts,tsx}"],
    plugins: { "jsx-a11y": jsxA11y, "react-hooks": reactHooks, "@next/next": nextPlugin },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // Each app is its own Next root. Without this, running eslint from the
    // workspace root makes the Next plugin look for a pages directory at the
    // repo root and complain on every file.
    settings: { next: { rootDir: ["apps/patient-web/", "apps/admin-web/", "apps/provider-web/", "apps/marketing-web/"] } },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // The screens already carry `eslint-disable react-hooks/*` comments in
      // the places where a dependency is deliberately omitted, so the plugin
      // has to be loaded for those directives to resolve at all.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // `no-img-element` matters here beyond performance: routing a presigned
      // document URL through Next's image optimiser would proxy PHI through
      // it. The screens that use a bare <img> disable it per line with that
      // reason, which only resolves if the plugin is loaded.
      "@next/next/no-img-element": "warn",
      "@next/next/no-sync-scripts": "error",
      // A warning, not an error: the marketing site is `output: "export"` with
      // `trailingSlash`, where a plain <a> is a correct, deliberate choice —
      // there is no client router to preserve. It stays on so a bare anchor
      // inside the two app shells still gets noticed.
      "@next/next/no-html-link-for-pages": "warn",
      // The design system draws its own controls, so these two fire on
      // patterns that are correct here and are covered by the axe suite.
      "jsx-a11y/no-autofocus": "off",
      "jsx-a11y/label-has-associated-control": "off",
      // Off: these screens set `role="list"` on purpose. Removing the bullets
      // with `list-style: none` also drops list semantics in Safari/VoiceOver,
      // and the item boundaries are what stop a dose list reading as one
      // run-on sentence — so the "redundant" role is what makes it work.
      "jsx-a11y/no-redundant-roles": "off",
      // A warning, not an error: the marketing voice samples and the film
      // genuinely have no caption files yet. Tracked in eslint-burndown.md
      // rather than silenced, so it stays visible until the captions exist.
      "jsx-a11y/media-has-caption": "warn",
    },
  },

  // Tests and scripts: looser. A test may shout at the console, and a
  // one-shot script may use require-style interop.
  {
    files: [
      "**/*.{test,spec}.{ts,tsx,mts}",
      "**/*.e2e-spec.ts",
      "**/test/**",
      "**/e2e/**",
      "**/e2e-marketing/**",
      "**/scripts/**",
      "**/*.config.{ts,mts,mjs,js}",
    ],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "import/order": "off",
      "no-console": "off",
    },
  },

  // Service workers run in their own global scope.
  {
    files: ["apps/*/app/sw.ts", "apps/*/**/sw.ts"],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.browser } },
  },

  /**
   * NestJS services: `consistent-type-imports` is OFF here, and this is a
   * safety rule, not a preference.
   *
   * Both Nest apps compile with `emitDecoratorMetadata`, which is how
   * constructor injection resolves: TypeScript emits the constructor's
   * parameter types as runtime metadata. An `import type` is erased, so the
   * metadata becomes `Object` and Nest can no longer resolve the dependency.
   * The rule is auto-fixable, so a single `eslint --fix` would rewrite the
   * constructor imports and break injection at runtime with nothing failing
   * at compile time. That happened once while this config was being written.
   */
  {
    files: ["apps/api/**/*.ts", "apps/abdm-gateway/**/*.ts"],
    rules: { "@typescript-eslint/consistent-type-imports": "off" },
  },
);
