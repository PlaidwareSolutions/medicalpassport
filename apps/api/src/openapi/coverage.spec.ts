import SwaggerParser from "@apidevtools/swagger-parser";
import { applyCiEnvDefaults } from "./env-defaults";
import { registryByKey, routeKey } from "./registry";

/**
 * OpenAPI contract coverage (ADR-V2-013, docs_v2/13 §2 "openapi:generate +
 * diff"). Boots the app once (no listening, no `init()`, so no DB access)
 * and checks that the registry and the real routes agree in both
 * directions, and that the assembled document is a structurally valid
 * OpenAPI 3.1 document.
 *
 * Whether the *committed* `openapi.json` matches is the CI script's job
 * (`openapi:check`), not this spec's — keeping the two failure modes apart.
 */
describe("OpenAPI contract coverage", () => {
  type BuildModule = typeof import("./build-document");
  let build: BuildModule;
  let routes: Awaited<ReturnType<BuildModule["enumerateRoutes"]>>;

  beforeAll(async () => {
    applyCiEnvDefaults();
    build = await import("./build-document");
    routes = await build.enumerateRoutes();
  });

  it("enumerates the API's routes", () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining(["GET /healthz", "GET /v1/meta/openapi.json", "POST /v1/auth/otp/request"]),
    );
  });

  it("every enumerated route has a registry entry", () => {
    const { missing } = build.diffRegistry(routes);
    if (missing.length) {
      throw new Error(`routes without a registry entry — add them to apps/api/src/openapi/registry.ts:\n  ${missing.join("\n  ")}`);
    }
  });

  it("every registry entry corresponds to a real route", () => {
    const { stale } = build.diffRegistry(routes);
    if (stale.length) {
      throw new Error(`registry entries with no matching route — remove or fix them in apps/api/src/openapi/registry.ts:\n  ${stale.join("\n  ")}`);
    }
  });

  it("registry rows agree with the handlers' auth/step-up/rate-limit decorators", () => {
    const byKey = registryByKey();
    const problems = routes.flatMap((route) => {
      const doc = byKey.get(routeKey(route.method, route.path));
      return doc ? build.crossCheck(route, doc) : [];
    });
    expect(problems).toEqual([]);
  });

  it("assembles a structurally valid OpenAPI 3.1 document", async () => {
    const document = build.assembleDocument(routes);
    expect(document.openapi).toBe("3.1.0");
    const paths = document.paths as Record<string, Record<string, unknown>>;
    const operations = Object.values(paths).reduce((n, item) => n + Object.keys(item).length, 0);
    expect(operations).toBe(routes.length);

    // swagger-parser validates against the OpenAPI 3.1 schema and resolves
    // every $ref; it mutates its input, so hand it a copy.
    await expect(SwaggerParser.validate(structuredClone(document) as never)).resolves.toBeDefined();
  });

  it("serializes deterministically", () => {
    const a = build.serializeDocument(build.assembleDocument(routes));
    const b = build.serializeDocument(build.assembleDocument(routes));
    expect(a).toBe(b);
    expect(a.endsWith("\n")).toBe(true);
  });
});
