import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError, isStepUpRequired } from "./index.js";

/**
 * ADR-V2-012 client half: a guarded endpoint's `403 step_up_required`
 * hands control to `onStepUpRequired`; the original call is retried
 * exactly once when the hook resolves true, surfaces unchanged when it
 * resolves false, and never loops when the retry is refused again.
 */

const stepUpProblem = {
  type: "https://medpass.app/problems/step_up_required",
  title: "Please confirm it's you",
  status: 403,
  code: "step_up_required",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientWith(responses: Response[], onStepUpRequired?: () => Promise<boolean>) {
  const fetchImpl = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("fetch called more times than scripted");
    return next;
  });
  const client = new ApiClient({ baseUrl: "http://api.test/v1", fetchImpl: fetchImpl as unknown as typeof fetch, onStepUpRequired });
  return { client, fetchImpl };
}

describe("ApiClient onStepUpRequired", () => {
  it("retries exactly once after the hook resolves true", async () => {
    const hook = vi.fn(async () => true);
    const { client, fetchImpl } = clientWith(
      [jsonResponse(403, stepUpProblem), jsonResponse(201, { id: "share-1", token: "t" })],
      hook,
    );

    const result = await client.post<{ id: string }>("/profiles/current/shares", { kind: "qr" }, { profileId: "p1" });

    expect(result).toEqual({ id: "share-1", token: "t" });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // The retry is the same request: method, URL, body and profile header.
    const [firstUrl, firstInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const [secondUrl, secondInit] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(secondUrl).toBe(firstUrl);
    expect(secondInit.method).toBe("POST");
    expect(secondInit.body).toBe(firstInit.body);
    expect((secondInit.headers as Record<string, string>)["x-profile-id"]).toBe("p1");
  });

  it("throws the original 403 when the hook resolves false, without retrying", async () => {
    const hook = vi.fn(async () => false);
    const { client, fetchImpl } = clientWith([jsonResponse(403, stepUpProblem)], hook);

    const failure = await client.post("/profiles/current/shares", {}).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(403);
    expect((failure as ApiError).problem.code).toBe("step_up_required");
    expect(isStepUpRequired(failure)).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not loop: a second 403 after the retry throws and never re-invokes the hook", async () => {
    const hook = vi.fn(async () => true);
    const { client, fetchImpl } = clientWith([jsonResponse(403, stepUpProblem), jsonResponse(403, stepUpProblem)], hook);

    const failure = await client.delete("/caregivers/c1").catch((e: unknown) => e);

    expect(isStepUpRequired(failure)).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("leaves other 403s alone", async () => {
    const hook = vi.fn(async () => true);
    const forbidden = { type: "about:blank", title: "Forbidden", status: 403, code: "forbidden" };
    const { client, fetchImpl } = clientWith([jsonResponse(403, forbidden)], hook);

    const failure = await client.get("/profiles/current/shares").catch((e: unknown) => e);

    expect((failure as ApiError).problem.code).toBe("forbidden");
    expect(isStepUpRequired(failure)).toBe(false);
    expect(hook).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces the 403 unchanged when no hook is configured", async () => {
    const { client, fetchImpl } = clientWith([jsonResponse(403, stepUpProblem)]);

    const failure = await client.post("/profiles/current/caregivers", {}).catch((e: unknown) => e);

    expect(isStepUpRequired(failure)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a 401 refresh retry can still step up once — the two hooks are independent", async () => {
    const onUnauthorized = vi.fn(async () => true);
    const onStepUpRequired = vi.fn(async () => true);
    const fetchImpl = vi.fn();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(401, { type: "about:blank", title: "Unauthorized", status: 401, code: "unauthorized" }))
      .mockResolvedValueOnce(jsonResponse(403, stepUpProblem))
      .mockResolvedValueOnce(jsonResponse(201, { id: "cg-1" }));
    const client = new ApiClient({
      baseUrl: "http://api.test/v1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onUnauthorized,
      onStepUpRequired,
    });

    await expect(client.post("/profiles/current/caregivers", {})).resolves.toEqual({ id: "cg-1" });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onStepUpRequired).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
