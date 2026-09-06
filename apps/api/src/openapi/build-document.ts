/**
 * Builds the OpenAPI 3.1 document (ADR-V2-013).
 *
 * 1. Boots the Nest app without listening (`NestFactory.create`, no `init()`,
 *    so no lifecycle hooks run and the database is never touched).
 * 2. Lets `SwaggerModule.createDocument` enumerate every real route (with the
 *    `/v1` global prefix and its exclusions exactly as `main.ts` applies them)
 *    and reads the auth/step-up/rate-limit decorators off each handler.
 * 3. Merges the declarative registry (`./registry.ts`) in: Zod request/query
 *    schemas via zod-to-json-schema, hand-written response fragments, and the
 *    global conventions from docs_v2/05 (headers, RFC 7807 problems,
 *    `step_up_required`, correlation ids).
 *
 * The registry is cross-checked against the decorators: a row that claims
 * less protection than the code enforces (or more) fails the build.
 */
import "reflect-metadata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { ModulesContainer, NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ZodType, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as validation from "@medpass/validation";
import { PUBLIC_ROUTE, REQUIRES_STEP_UP } from "../common/auth.guard";
import { RATE_LIMIT_KEY, type RateLimitOptions } from "../common/rate-limit.guard";
import { applyCiEnvDefaults } from "./env-defaults";
import { ROUTES, registryByKey, routeKey, toOpenApiPath, TAG_DESCRIPTIONS, type QueryParam, type ResponseSpec, type RouteDoc } from "./registry";
import { problemSchema, type JsonSchema } from "./schemas";

// ───────────────────────── Route enumeration ─────────────────────────

export interface HandlerMeta {
  /** `@Public()` on the handler or its controller (skips the patient AuthGuard only). */
  isPublic: boolean;
  /** `@UseGuards(AdminAuthGuard)` on the handler or its controller. */
  adminGuard: boolean;
  /** `@UseGuards(ProviderGuard)` on the handler or its controller (provider portal, V2 Phases 11–14). */
  providerGuard: boolean;
  stepUp: boolean;
  rateLimit?: string;
}

export interface EnumeratedRoute {
  method: string; // upper-case
  /** OpenAPI template form, e.g. `/v1/medications/{id}`. */
  path: string;
  operationId: string;
  /** Success status Nest will emit (from `@HttpCode()` or the method default). */
  successStatus: number;
  /** Path parameters as Swagger discovered them. */
  pathParams: Array<Record<string, unknown>>;
  meta: HandlerMeta;
}

type SwaggerOperation = {
  operationId?: string;
  parameters?: Array<Record<string, unknown>>;
  responses?: Record<string, unknown>;
};

async function createApp(): Promise<INestApplication> {
  applyCiEnvDefaults();
  // Imported lazily so the env defaults above are in place before
  // app.module.ts evaluates `env()` while assembling its providers.
  const { AppModule } = await import("../app.module");
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  // Must mirror main.ts exactly — this is what makes the enumerated paths
  // "the final path as Nest exposes it".
  app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
  return app;
}

function collectHandlerMeta(app: INestApplication): Map<string, HandlerMeta> {
  const out = new Map<string, HandlerMeta>();
  const modules = app.get(ModulesContainer, { strict: false });
  for (const module of modules.values()) {
    for (const wrapper of module.controllers.values()) {
      const cls = wrapper.metatype as (new (...args: unknown[]) => unknown) | undefined;
      if (!cls || typeof cls !== "function") continue;
      const proto = cls.prototype as Record<string, unknown>;
      const classPublic = Reflect.getMetadata(PUBLIC_ROUTE, cls) === true;
      const classGuards = (Reflect.getMetadata(GUARDS_METADATA, cls) as unknown[] | undefined) ?? [];
      const classAdmin = classGuards.some(isAdminGuard);
      const classProvider = classGuards.some(isProviderGuard);
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === "constructor") continue;
        const handler = proto[name];
        if (typeof handler !== "function") continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? [];
        const rateLimit = Reflect.getMetadata(RATE_LIMIT_KEY, handler) as RateLimitOptions | undefined;
        out.set(`${cls.name}_${name}`, {
          isPublic: classPublic || Reflect.getMetadata(PUBLIC_ROUTE, handler) === true,
          adminGuard: classAdmin || guards.some(isAdminGuard),
          providerGuard: classProvider || guards.some(isProviderGuard),
          stepUp: Reflect.getMetadata(REQUIRES_STEP_UP, handler) === true || Reflect.getMetadata(REQUIRES_STEP_UP, cls) === true,
          rateLimit: rateLimit?.name,
        });
      }
    }
  }
  return out;
}

function isAdminGuard(guard: unknown): boolean {
  return typeof guard === "function" && guard.name === "AdminAuthGuard";
}

function isProviderGuard(guard: unknown): boolean {
  return typeof guard === "function" && guard.name === "ProviderGuard";
}

/** Boots the app, enumerates every route and its handler metadata, closes the app. */
export async function enumerateRoutes(): Promise<EnumeratedRoute[]> {
  const app = await createApp();
  try {
    const base = SwaggerModule.createDocument(app, new DocumentBuilder().setOpenAPIVersion("3.1.0").build());
    const metaByOperation = collectHandlerMeta(app);
    const routes: EnumeratedRoute[] = [];
    for (const [path, item] of Object.entries(base.paths)) {
      for (const [method, op] of Object.entries(item as Record<string, SwaggerOperation>)) {
        if (!op || typeof op !== "object" || !("operationId" in op)) continue;
        const operationId = op.operationId ?? `${method} ${path}`;
        const meta = metaByOperation.get(operationId);
        if (!meta) throw new Error(`openapi: no handler metadata for ${operationId} (${method.toUpperCase()} ${path})`);
        const statuses = Object.keys(op.responses ?? {});
        routes.push({
          method: method.toUpperCase(),
          path,
          operationId,
          successStatus: Number(statuses[0] ?? (method === "post" ? 201 : 200)),
          pathParams: (op.parameters ?? []).filter((p) => p.in === "path"),
          meta,
        });
      }
    }
    routes.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
    return routes;
  } finally {
    await app.close();
  }
}

export interface RegistryDiff {
  /** Real routes with no registry row. */
  missing: string[];
  /** Registry rows naming a route that does not exist. */
  stale: string[];
}

export function diffRegistry(routes: EnumeratedRoute[]): RegistryDiff {
  const registry = registryByKey();
  const real = new Set(routes.map((r) => routeKey(r.method, r.path)));
  return {
    missing: [...real].filter((k) => !registry.has(k)).sort(),
    stale: [...registry.keys()].filter((k) => !real.has(k)).sort(),
  };
}

// ───────────────────────── Schema conversion ─────────────────────────

const HAND_WRITTEN = "hand-written";

/** `otpRequestSchema` → `OtpRequest`, keyed by object identity so the registry needs no names. */
const zodSchemaNames: Map<ZodTypeAny, string> = (() => {
  const names = new Map<ZodTypeAny, string>();
  for (const [exportName, value] of Object.entries(validation)) {
    if (value instanceof ZodType && !names.has(value)) {
      const base = exportName.replace(/Schema$/, "");
      names.set(value, base.charAt(0).toUpperCase() + base.slice(1));
    }
  }
  return names;
})();

function isZod(value: unknown): value is ZodTypeAny {
  return value instanceof ZodType;
}

function zodToSchema(schema: ZodTypeAny): JsonSchema {
  // The library's overloads recurse through the Zod type; call it untyped.
  const convert = zodToJsonSchema as unknown as (s: ZodTypeAny, o: Record<string, unknown>) => JsonSchema;
  const converted = convert(schema, { $refStrategy: "none", target: "jsonSchema7" });
  delete converted.$schema;
  // A top-level `.optional()` (e.g. an optional empty body) converts to
  // `anyOf: [{not: {}}, X]`; the request body's `required: false` already
  // says "may be absent", so unwrap to X.
  const anyOf = converted.anyOf as JsonSchema[] | undefined;
  if (anyOf?.length === 2 && anyOf[0] && Object.keys(anyOf[0]).length === 1 && "not" in anyOf[0]) return anyOf[1]!;
  return converted;
}

class SchemaRegistry {
  readonly components: Record<string, JsonSchema> = { Problem: problemSchema };

  ref(schema: ZodTypeAny): JsonSchema {
    const name = zodSchemaNames.get(schema);
    if (!name) return zodToSchema(schema); // not exported from @medpass/validation: inline
    if (!this.components[name]) this.components[name] = zodToSchema(schema);
    return { $ref: `#/components/schemas/${name}` };
  }
}

// ───────────────────────── Conventions (docs_v2/05) ─────────────────────────

const problemRef = { $ref: "#/components/schemas/Problem" };
const correlationHeaderRef = { "x-correlation-id": { $ref: "#/components/headers/CorrelationId" } };

function problemResponse(description: string, codes: string[]): JsonSchema {
  return {
    description: `${description} Problem \`code\`: ${codes.map((c) => `\`${c}\``).join(", ")}.`,
    headers: correlationHeaderRef,
    content: { "application/problem+json": { schema: problemRef } },
  };
}

const COMPONENT_RESPONSES: Record<string, JsonSchema> = {
  ValidationFailed: problemResponse("The body, query or a required header is invalid.", ["validation_failed"]),
  Unauthenticated: problemResponse("No usable session.", ["unauthenticated", "session_revoked"]),
  Forbidden: problemResponse("The session may not perform this action.", ["forbidden", "caregiver_scope_missing"]),
  StepUpRequired: problemResponse(
    "The session must re-verify (OTP/TOTP) within the last 10 minutes before this action (ADR-V2-012).",
    ["step_up_required"],
  ),
  NotFound: problemResponse("The resource does not exist or is not visible to this session.", ["not_found"]),
  Conflict: problemResponse("Optimistic-concurrency or idempotency conflict.", ["conflict_row_version", "idempotent_replay_mismatch"]),
  RateLimited: problemResponse("Per-IP budget exhausted; honour `retry-after`.", ["rate_limited"]),
  Problem: problemResponse("Any other error.", ["internal_error", "…"]),
};

const COMPONENT_PARAMETERS: Record<string, JsonSchema> = {
  XClient: {
    name: "x-client",
    in: "header",
    required: false,
    description: "Calling client; stored as `recordedVia` on clinical writes. Missing → `pwa`.",
    schema: { type: "string", enum: ["pwa", "native_android", "native_ios", "provider_web"] },
  },
  XRequestedWith: {
    name: "x-requested-with",
    in: "header",
    required: true,
    description: "CSRF defense for cookie-borne state-changing requests; must be `medpass`. Not required with a bearer token.",
    schema: { type: "string", enum: ["medpass"] },
  },
  XProfileId: {
    name: "x-profile-id",
    in: "header",
    required: true,
    description: "The active patient profile. Access is decided per request from the caller's relationship to this profile (owner, claimed, or caregiver scope).",
    schema: { type: "string", format: "uuid" },
  },
  XCorrelationId: {
    name: "x-correlation-id",
    in: "header",
    required: false,
    description: "Client/edge-supplied correlation id (8–64 URL-safe chars); otherwise the API mints one. Echoed on every response.",
    schema: { type: "string", pattern: "^[A-Za-z0-9-]{8,64}$" },
  },
  IdempotencyKey: {
    name: "idempotency-key",
    in: "header",
    required: false,
    description: "Client-generated key for writes that may be retried; a replay with a different body is rejected with `idempotent_replay_mismatch`.",
    schema: { type: "string", maxLength: 128 },
  },
};

const SECURITY_SCHEMES: Record<string, JsonSchema> = {
  sessionCookie: { type: "apiKey", in: "cookie", name: "medpass_session", description: "Opaque patient session (browsers)." },
  bearerSession: { type: "http", scheme: "bearer", description: "The same opaque patient session token, for native clients." },
  adminSessionCookie: { type: "apiKey", in: "cookie", name: "medpass_admin_session", description: "Opaque admin-portal session (MFA-verified unless noted)." },
  adminBearer: { type: "http", scheme: "bearer", description: "The admin session token as a bearer." },
  providerSessionCookie: { type: "apiKey", in: "cookie", name: "medpass_provider_session", description: "Opaque provider-portal session (browsers); a distinct token type, never interchangeable with a patient or admin session." },
  providerBearer: { type: "http", scheme: "bearer", description: "The provider session token (`mpp_…`) as a bearer." },
};

const SECURITY_BY_AUTH: Record<RouteDoc["auth"], unknown[]> = {
  public: [],
  "share-token": [],
  webhook: [],
  patient: [{ sessionCookie: [] }, { bearerSession: [] }],
  admin: [{ adminSessionCookie: [] }, { adminBearer: [] }],
  provider: [{ providerSessionCookie: [] }, { providerBearer: [] }],
};

const AUTH_DESCRIPTIONS: Record<RouteDoc["auth"], string> = {
  public: "No credential required.",
  patient: "Patient session (cookie or bearer).",
  admin: "Admin-portal session.",
  provider: "Provider-portal session (cookie or bearer); organization context from the membership, or `x-organization-id` when the user belongs to several.",
  "share-token": "No session — the capability token in the path is the authorization.",
  webhook: "No session — verified by the provider's signature headers.",
};

const HTTP_TEXT: Record<number, string> = { 200: "OK", 201: "Created", 202: "Accepted", 204: "No Content" };

// ───────────────────────── Registry ↔ decorator cross-check ─────────────────────────

function expectedAuthKinds(meta: HandlerMeta): RouteDoc["auth"][] {
  if (meta.adminGuard) return ["admin"];
  if (meta.providerGuard) return ["provider"];
  if (meta.isPublic) return ["public", "share-token", "webhook"];
  return ["patient"];
}

export function crossCheck(route: EnumeratedRoute, doc: RouteDoc): string[] {
  const problems: string[] = [];
  const key = routeKey(route.method, route.path);
  const allowed = expectedAuthKinds(route.meta);
  if (!allowed.includes(doc.auth)) problems.push(`${key}: registry auth "${doc.auth}" but decorators imply ${allowed.join("|")}`);
  if (!!doc.stepUp !== route.meta.stepUp) problems.push(`${key}: registry stepUp=${!!doc.stepUp} but @RequiresStepUp is ${route.meta.stepUp}`);
  if ((doc.rateLimit ?? undefined) !== route.meta.rateLimit) {
    problems.push(`${key}: registry rateLimit=${doc.rateLimit ?? "none"} but @RateLimit is ${route.meta.rateLimit ?? "none"}`);
  }
  if (route.successStatus === 204 && doc.response !== undefined) problems.push(`${key}: 204 route must not declare a response body`);
  if (route.successStatus !== 204 && doc.response === undefined) problems.push(`${key}: response is required (non-204 route)`);
  if (doc.response !== undefined && !isZod(doc.response) && doc.responseSchemaSource !== HAND_WRITTEN) {
    problems.push(`${key}: non-Zod response must be marked responseSchemaSource: "hand-written"`);
  }
  return problems;
}

// ───────────────────────── Operation assembly ─────────────────────────

function queryParameters(query: RouteDoc["query"], schemas: SchemaRegistry): JsonSchema[] {
  if (!query) return [];
  if (Array.isArray(query)) {
    return query.map((q: QueryParam) => ({
      name: q.name,
      in: "query",
      required: q.required ?? false,
      ...(q.description ? { description: q.description } : {}),
      schema: q.schema,
    }));
  }
  const converted = zodToSchema(query);
  void schemas;
  const properties = (converted.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((converted.required as string[] | undefined) ?? []);
  return Object.entries(properties).map(([name, schema]) => {
    const { description, ...rest } = schema;
    return {
      name,
      in: "query",
      required: required.has(name),
      ...(description ? { description } : {}),
      schema: rest,
    };
  });
}

function headerParameters(doc: RouteDoc, method: string): JsonSchema[] {
  const params: JsonSchema[] = [{ $ref: "#/components/parameters/XClient" }, { $ref: "#/components/parameters/XCorrelationId" }];
  const authenticated = doc.auth === "patient" || doc.auth === "admin" || doc.auth === "provider";
  if (authenticated && method !== "GET") params.push({ $ref: "#/components/parameters/XRequestedWith" });
  for (const header of doc.headers ?? []) {
    if (header === "x-profile-id") params.push({ $ref: "#/components/parameters/XProfileId" });
    else if (header === "idempotency-key") params.push({ $ref: "#/components/parameters/IdempotencyKey" });
    else params.push({ name: header, in: "header", required: true, schema: { type: "string" } });
  }
  return params;
}

function bodySchema(schema: ZodTypeAny | JsonSchema, schemas: SchemaRegistry): JsonSchema {
  return isZod(schema) ? schemas.ref(schema) : schema;
}

function successResponses(route: EnumeratedRoute, doc: RouteDoc, schemas: SchemaRegistry): Record<string, JsonSchema> {
  const out: Record<string, JsonSchema> = {};
  const specs: ResponseSpec[] =
    doc.response === undefined
      ? [{ status: route.successStatus }]
      : Array.isArray(doc.response)
        ? doc.response
        : [{ status: route.successStatus, schema: doc.response }];
  for (const spec of specs) {
    const description = spec.description ?? HTTP_TEXT[spec.status] ?? "Success";
    out[String(spec.status)] = {
      description,
      headers: correlationHeaderRef,
      ...(spec.schema !== undefined
        ? { content: { [spec.contentType ?? "application/json"]: { schema: bodySchema(spec.schema, schemas) } } }
        : {}),
    };
  }
  return out;
}

function errorResponses(route: EnumeratedRoute, doc: RouteDoc): Record<string, JsonSchema> {
  const out: Record<string, JsonSchema> = {};
  const ref = (name: string) => ({ $ref: `#/components/responses/${name}` });
  const hasInput = doc.request !== undefined || doc.query !== undefined || (doc.headers ?? []).includes("x-profile-id");
  if (hasInput) out["400"] = ref("ValidationFailed");
  if (doc.auth === "patient" || doc.auth === "admin" || doc.auth === "provider") {
    out["401"] = ref("Unauthenticated");
    out["403"] = doc.stepUp ? ref("StepUpRequired") : ref("Forbidden");
  }
  if (route.pathParams.length > 0 || doc.auth === "share-token") out["404"] = ref("NotFound");
  if (route.method === "PATCH" || (doc.headers ?? []).includes("idempotency-key")) out["409"] = ref("Conflict");
  if (doc.rateLimit) out["429"] = ref("RateLimited");
  out.default = ref("Problem");
  return out;
}

function buildOperation(route: EnumeratedRoute, doc: RouteDoc, schemas: SchemaRegistry): JsonSchema {
  const notes: string[] = [AUTH_DESCRIPTIONS[doc.auth]];
  if (doc.scope) notes.push(`Profile access: \`${doc.scope}\` on \`x-profile-id\`.`);
  if (doc.duty) notes.push(`Admin duty: \`${doc.duty}\`.`);
  if (doc.stepUp) notes.push("Step-up: the session must have re-verified within 10 minutes (`403 step_up_required` otherwise).");
  if (doc.rateLimit) notes.push(`Rate limit bucket: \`${doc.rateLimit}\` (per IP).`);
  const description = [doc.description, notes.join(" ")].filter(Boolean).join("\n\n");

  const parameters = [...route.pathParams, ...queryParameters(doc.query, schemas), ...headerParameters(doc, route.method)];

  const operation: JsonSchema = {
    operationId: route.operationId,
    summary: doc.summary,
    description,
    tags: doc.tags,
    ...(doc.deprecated ? { deprecated: true } : {}),
    parameters,
    ...(doc.request
      ? {
          requestBody: {
            required: !doc.requestOptional,
            content: { "application/json": { schema: schemas.ref(doc.request) } },
          },
        }
      : {}),
    responses: { ...successResponses(route, doc, schemas), ...errorResponses(route, doc) },
    security: SECURITY_BY_AUTH[doc.auth],
    "x-auth": doc.auth,
    "x-step-up": !!doc.stepUp,
    ...(doc.rateLimit ? { "x-rate-limit": doc.rateLimit } : {}),
    ...(doc.scope ? { "x-profile-scope": doc.scope } : {}),
    ...(doc.duty ? { "x-admin-duty": doc.duty } : {}),
    ...(doc.response !== undefined ? { "x-response-schema-source": isZod(doc.response) ? "zod" : HAND_WRITTEN } : {}),
  };
  return operation;
}

// ───────────────────────── Document assembly ─────────────────────────

function apiVersion(): string {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}

const INFO_DESCRIPTION = `Medicine Passport patient/admin API. Generated from the Nest routes plus the Zod DTOs in \`packages/validation\` (ADR-V2-013); pinned at \`apps/api/openapi.json\` and diffed in CI.

Conventions (docs_v2/05): \`/v1\` prefix; RFC 7807 \`application/problem+json\` errors with a stable \`code\` and \`correlationId\`; opaque session cookie or bearer; \`x-requested-with: medpass\` on cookie-borne writes; \`x-profile-id\` selects the active profile; \`idempotency-key\` on retried writes; \`x-client\` names the calling client; step-up endpoints answer \`403 step_up_required\` when the session's re-verification is older than 10 minutes; \`x-correlation-id\` is echoed on every response.

Response bodies marked \`x-response-schema-source: hand-written\` are provisional descriptions maintained by hand until a Zod response schema exists; request bodies marked \`zod\` are authoritative.`;

/** Pure: assembles the document from enumerated routes. Throws on registry gaps or contradictions. */
export function assembleDocument(routes: EnumeratedRoute[]): Record<string, unknown> {
  const diff = diffRegistry(routes);
  const problems: string[] = [
    ...diff.missing.map((k) => `no registry entry for ${k}`),
    ...diff.stale.map((k) => `registry entry for non-existent route ${k}`),
  ];
  const registry = registryByKey();
  const schemas = new SchemaRegistry();
  const paths: Record<string, Record<string, JsonSchema>> = {};

  for (const route of routes) {
    const doc = registry.get(routeKey(route.method, route.path));
    if (!doc) continue;
    problems.push(...crossCheck(route, doc));
    (paths[route.path] ??= {})[route.method.toLowerCase()] = buildOperation(route, doc, schemas);
  }
  if (problems.length) {
    throw new Error(`openapi registry (apps/api/src/openapi/registry.ts) is out of step with the routes:\n  - ${problems.join("\n  - ")}`);
  }

  const tagNames = [...new Set(ROUTES.flatMap((r) => r.tags))].sort();
  const document = {
    openapi: "3.1.0",
    info: { title: "Medicine Passport API", version: apiVersion(), description: INFO_DESCRIPTION },
    servers: [{ url: "/", description: "Same origin as the calling app (the PWA calls /v1 on its own origin)." }],
    tags: tagNames.map((name) => ({ name, ...(TAG_DESCRIPTIONS[name] ? { description: TAG_DESCRIPTIONS[name] } : {}) })),
    paths: sortKeys(paths),
    components: sortKeys({
      schemas: schemas.components,
      parameters: COMPONENT_PARAMETERS,
      headers: {
        CorrelationId: { description: "Request correlation id; quote it in support requests.", schema: { type: "string" } },
      },
      responses: COMPONENT_RESPONSES,
      securitySchemes: SECURITY_SCHEMES,
    }),
  };
  return document;
}

/** Boots the app, enumerates routes, assembles the document. */
export async function buildOpenApiDocument(): Promise<Record<string, unknown>> {
  return assembleDocument(await enumerateRoutes());
}

/** Deterministic text form: sorted keys below the top level, 2-space indent, trailing newline. */
export function serializeDocument(document: Record<string, unknown>): string {
  return JSON.stringify(document, null, 2) + "\n";
}

/**
 * Well-known keys first (in this order), everything else alphabetical — for
 * readable, stable output. Applied below the top level (whose order is fixed
 * in `assembleDocument`).
 */
const PREFERRED_KEY_ORDER = [
  "operationId", "summary", "description", "deprecated",
  "name", "in", "schema",
  "$ref", "type", "format", "enum", "const", "default", "required",
  "properties", "additionalProperties", "items", "anyOf", "oneOf", "allOf",
  "parameters", "requestBody", "responses", "security",
  "headers", "content",
];
const keyRank = new Map(PREFERRED_KEY_ORDER.map((k, i) => [k, i]));

function compareKeys(a: string, b: string): number {
  const ra = keyRank.get(a);
  const rb = keyRank.get(b);
  if (ra !== undefined && rb !== undefined) return ra - rb;
  if (ra !== undefined) return -1;
  if (rb !== undefined) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sortKeys) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort(compareKeys)) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
}
