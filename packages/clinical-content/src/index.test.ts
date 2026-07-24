import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchIndicationForIngredient, pickBestIndication } from "./index.js";

function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const SINGLE_INGREDIENT_LABEL = {
  id: "label-1",
  set_id: "set-metformin-1",
  effective_time: "20240115",
  indications_and_usage: ["Metformin is indicated to improve glycemic control in adults with type 2 diabetes mellitus."],
  openfda: { generic_name: ["METFORMIN HYDROCHLORIDE"], substance_name: ["METFORMIN HYDROCHLORIDE"] },
};

const COMBINATION_LABEL = {
  id: "label-2",
  set_id: "set-combo-1",
  effective_time: "20240301",
  indications_and_usage: ["This fixed-dose combination is indicated as an adjunct to diet and exercise..."],
  openfda: { generic_name: ["SITAGLIPTIN", "METFORMIN HYDROCHLORIDE"], substance_name: ["SITAGLIPTIN", "METFORMIN HYDROCHLORIDE"] },
};

describe("pickBestIndication (pure, no network)", () => {
  it("picks a clean single-ingredient label", () => {
    const result = pickBestIndication({ results: [SINGLE_INGREDIENT_LABEL] }, "metformin");
    expect(result).not.toBeNull();
    expect(result!.text).toContain("type 2 diabetes");
    expect(result!.sourceCitation).toContain("set-metformin-1");
    expect(result!.sourceCitation).toContain("2024-01-15");
    expect(result!.sourceUrl).toContain("set-metformin-1");
  });

  it("rejects a combination-product label even when it's the only result", () => {
    const result = pickBestIndication({ results: [COMBINATION_LABEL] }, "metformin");
    expect(result).toBeNull();
  });

  it("prefers a single-ingredient label over a combination one, regardless of order", () => {
    const result = pickBestIndication({ results: [COMBINATION_LABEL, SINGLE_INGREDIENT_LABEL] }, "metformin");
    expect(result!.sourceCitation).toContain("set-metformin-1");
  });

  it("prefers the most recently effective label among several valid candidates", () => {
    const older = { ...SINGLE_INGREDIENT_LABEL, set_id: "set-older", effective_time: "20100101" };
    const newer = { ...SINGLE_INGREDIENT_LABEL, set_id: "set-newer", effective_time: "20250601" };
    const result = pickBestIndication({ results: [older, newer] }, "metformin");
    expect(result!.sourceCitation).toContain("set-newer");
  });

  it("dedupes repeated set_ids", () => {
    const result = pickBestIndication({ results: [SINGLE_INGREDIENT_LABEL, SINGLE_INGREDIENT_LABEL] }, "metformin");
    expect(result).not.toBeNull();
  });

  it("returns null for zero results", () => {
    expect(pickBestIndication({ results: [] }, "metformin")).toBeNull();
  });

  it("returns null for a result missing the openfda block", () => {
    const noOpenfda = { ...SINGLE_INGREDIENT_LABEL, openfda: undefined };
    expect(pickBestIndication({ results: [noOpenfda] }, "metformin")).toBeNull();
  });
});

describe("fetchIndicationForIngredient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a result on the ingredient's own name without needing synonyms", async () => {
    mockFetchOnce(200, { results: [SINGLE_INGREDIENT_LABEL] });
    const result = await fetchIndicationForIngredient("Metformin", ["Glucophage"]);
    expect(result!.text).toContain("type 2 diabetes");
  });

  it("falls back through synonyms — the Paracetamol/Acetaminophen INN vs. US-name gap", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.toLowerCase().includes("paracetamol")) return { ok: false, status: 404, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [{ ...SINGLE_INGREDIENT_LABEL, indications_and_usage: ["Acetaminophen is indicated for the temporary relief of minor aches and pains."] }],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchIndicationForIngredient("Paracetamol", ["Acetaminophen"]);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("minor aches and pains");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null (never fabricates) when no name or synonym yields a confident match", async () => {
    mockFetchOnce(404, {});
    const result = await fetchIndicationForIngredient("SomeUnknownIngredient", ["AlsoUnknown"]);
    expect(result).toBeNull();
  });

  it("throws on a 5xx/429 response instead of returning null, so job-queue retry can distinguish it from 'no data'", async () => {
    mockFetchOnce(429, { error: "rate limited" });
    await expect(fetchIndicationForIngredient("Metformin")).rejects.toThrow(/openfda_http_429/);
  });
});
