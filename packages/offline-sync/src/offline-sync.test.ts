import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDbHandleForTests } from "./db.js";
import {
  cacheMedications,
  cacheTimeline,
  checkStorageStatus,
  clearAllOfflineData,
  clearProfileData,
  dismissConflict,
  getCachedMedications,
  getCachedTimeline,
  getLastSynced,
  getSyncCursor,
  listConflicts,
  recordConflict,
  setLastSynced,
  setSyncCursor,
  trimToEssentials,
} from "./cache.js";
import { enqueueMutation, listPendingMutations, pendingMutationCount, removeMutation } from "./queue.js";
import type { OfflineMutation } from "./contract.js";

const PROFILE_A = "profile-a";
const PROFILE_B = "profile-b";

function makeMutation(overrides: Partial<OfflineMutation> = {}): OfflineMutation {
  return {
    clientMutationId: crypto.randomUUID(),
    entity: "dose_event",
    operation: "create",
    payload: { action: "taken" },
    capturedAt: new Date().toISOString(),
    profileId: PROFILE_A,
    ...overrides,
  };
}

beforeEach(() => {
  _resetDbHandleForTests();
});

afterEach(async () => {
  await clearAllOfflineData();
  _resetDbHandleForTests();
  vi.unstubAllGlobals();
});

describe("medication + timeline cache", () => {
  it("round-trips cached medications with a cachedAt timestamp", async () => {
    await cacheMedications(PROFILE_A, "current", [{ id: "m1", name: "Metformin" }]);
    const result = await getCachedMedications<Array<{ id: string; name: string }>>(PROFILE_A, "current");
    expect(result?.items).toEqual([{ id: "m1", name: "Metformin" }]);
    expect(new Date(result!.cachedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it("returns undefined when nothing is cached yet", async () => {
    expect(await getCachedMedications(PROFILE_A, "current")).toBeUndefined();
  });

  it("keeps medication caches separate per variant (current vs all)", async () => {
    await cacheMedications(PROFILE_A, "current", [{ id: "current-only" }]);
    await cacheMedications(PROFILE_A, "all", [{ id: "current-only" }, { id: "past" }]);
    expect((await getCachedMedications(PROFILE_A, "current"))?.items).toEqual([{ id: "current-only" }]);
    expect((await getCachedMedications(PROFILE_A, "all"))?.items).toEqual([{ id: "current-only" }, { id: "past" }]);
  });

  it("keeps timeline caches separate per date", async () => {
    await cacheTimeline(PROFILE_A, "2026-07-17", [{ slot: "morning" }]);
    await cacheTimeline(PROFILE_A, "2026-07-18", [{ slot: "night" }]);
    expect((await getCachedTimeline(PROFILE_A, "2026-07-17"))?.items).toEqual([{ slot: "morning" }]);
    expect((await getCachedTimeline(PROFILE_A, "2026-07-18"))?.items).toEqual([{ slot: "night" }]);
  });

  it("keeps caches separate per profile (caregiver switching profiles)", async () => {
    await cacheMedications(PROFILE_A, "current", [{ id: "a" }]);
    await cacheMedications(PROFILE_B, "current", [{ id: "b" }]);
    expect((await getCachedMedications(PROFILE_A, "current"))?.items).toEqual([{ id: "a" }]);
    expect((await getCachedMedications(PROFILE_B, "current"))?.items).toEqual([{ id: "b" }]);
  });

  it("tracks last-synced time per profile", async () => {
    expect(await getLastSynced(PROFILE_A)).toBeUndefined();
    const now = new Date().toISOString();
    await setLastSynced(PROFILE_A, now);
    expect(await getLastSynced(PROFILE_A)).toBe(now);
  });
});

describe("mutation queue", () => {
  it("enqueues and lists mutations in capture order", async () => {
    const m1 = makeMutation({ capturedAt: "2026-07-17T08:00:00.000Z" });
    const m2 = makeMutation({ capturedAt: "2026-07-17T08:05:00.000Z" });
    await enqueueMutation(m2);
    await enqueueMutation(m1);
    const listed = await listPendingMutations();
    expect(listed.map((m) => m.clientMutationId)).toEqual([m1.clientMutationId, m2.clientMutationId]);
  });

  it("removes a mutation once synced, and counts pending accurately", async () => {
    const m1 = makeMutation();
    const m2 = makeMutation();
    await enqueueMutation(m1);
    await enqueueMutation(m2);
    expect(await pendingMutationCount()).toBe(2);
    await removeMutation(m1.clientMutationId);
    expect(await pendingMutationCount()).toBe(1);
    const remaining = await listPendingMutations();
    expect(remaining.map((m) => m.clientMutationId)).toEqual([m2.clientMutationId]);
  });

  it("re-enqueuing the same clientMutationId overwrites rather than duplicates", async () => {
    const m = makeMutation();
    await enqueueMutation(m);
    await enqueueMutation({ ...m, payload: { action: "skipped" } });
    expect(await pendingMutationCount()).toBe(1);
    const [only] = await listPendingMutations();
    expect(only!.payload).toEqual({ action: "skipped" });
  });
});

describe("clearing cached data", () => {
  it("clearProfileData wipes only the target profile's caches", async () => {
    await cacheMedications(PROFILE_A, "current", [{ id: "a" }]);
    await cacheMedications(PROFILE_B, "current", [{ id: "b" }]);
    await cacheTimeline(PROFILE_A, "2026-07-17", [{ slot: "morning" }]);
    await setLastSynced(PROFILE_A, new Date().toISOString());

    await clearProfileData(PROFILE_A);

    expect(await getCachedMedications(PROFILE_A, "current")).toBeUndefined();
    expect(await getCachedTimeline(PROFILE_A, "2026-07-17")).toBeUndefined();
    expect(await getLastSynced(PROFILE_A)).toBeUndefined();
    expect((await getCachedMedications(PROFILE_B, "current"))?.items).toEqual([{ id: "b" }]);
  });

  it("clearAllOfflineData wipes caches and the mutation queue across all profiles", async () => {
    await cacheMedications(PROFILE_A, "current", [{ id: "a" }]);
    await enqueueMutation(makeMutation());
    await clearAllOfflineData();
    expect(await getCachedMedications(PROFILE_A, "current")).toBeUndefined();
    expect(await pendingMutationCount()).toBe(0);
  });

  it("clearProfileData also wipes that profile's sync cursor and conflicts", async () => {
    await setSyncCursor(PROFILE_A, "2026-07-19T00:00:00.000Z");
    await recordConflict({
      clientMutationId: "c1",
      profileId: PROFILE_A,
      entity: "patient_medication",
      kind: "row_version",
      detectedAt: new Date().toISOString(),
    });
    await clearProfileData(PROFILE_A);
    expect(await getSyncCursor(PROFILE_A)).toBeUndefined();
    expect(await listConflicts(PROFILE_A)).toEqual([]);
  });
});

describe("incremental-sync cursor", () => {
  it("round-trips a cursor per profile, undefined until first set", async () => {
    expect(await getSyncCursor(PROFILE_A)).toBeUndefined();
    await setSyncCursor(PROFILE_A, "2026-07-19T08:00:00.000Z");
    await setSyncCursor(PROFILE_B, "2026-07-19T09:00:00.000Z");
    expect(await getSyncCursor(PROFILE_A)).toBe("2026-07-19T08:00:00.000Z");
    expect(await getSyncCursor(PROFILE_B)).toBe("2026-07-19T09:00:00.000Z");
  });

  it("overwrites the previous cursor for the same profile", async () => {
    await setSyncCursor(PROFILE_A, "2026-07-19T08:00:00.000Z");
    await setSyncCursor(PROFILE_A, "2026-07-19T09:00:00.000Z");
    expect(await getSyncCursor(PROFILE_A)).toBe("2026-07-19T09:00:00.000Z");
  });
});

describe("conflict review store", () => {
  it("records, lists (optionally filtered by profile), and dismisses a conflict", async () => {
    await recordConflict({
      clientMutationId: "c1",
      profileId: PROFILE_A,
      entity: "patient_medication",
      kind: "field_conflict",
      unmergedFields: ["instruction"],
      serverState: { id: "med-1", enteredName: "Metformin" },
      detectedAt: "2026-07-19T08:00:00.000Z",
    });
    await recordConflict({
      clientMutationId: "c2",
      profileId: PROFILE_B,
      entity: "patient_medication",
      kind: "row_version",
      detectedAt: "2026-07-19T08:05:00.000Z",
    });

    expect((await listConflicts()).map((c) => c.clientMutationId).sort()).toEqual(["c1", "c2"]);
    expect((await listConflicts(PROFILE_A)).map((c) => c.clientMutationId)).toEqual(["c1"]);

    await dismissConflict("c1");
    expect(await listConflicts(PROFILE_A)).toEqual([]);
    expect((await listConflicts(PROFILE_B)).map((c) => c.clientMutationId)).toEqual(["c2"]);
  });

  it("replaces rather than duplicates when the same mutation conflicts again", async () => {
    await recordConflict({ clientMutationId: "c1", profileId: PROFILE_A, entity: "patient_medication", kind: "row_version", detectedAt: "2026-07-19T08:00:00.000Z" });
    await recordConflict({ clientMutationId: "c1", profileId: PROFILE_A, entity: "patient_medication", kind: "field_conflict", unmergedFields: ["instruction"], detectedAt: "2026-07-19T08:10:00.000Z" });
    const items = await listConflicts(PROFILE_A);
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("field_conflict");
  });
});

describe("storage-quota status and trimming", () => {
  it("reports not-low when navigator.storage.estimate is unavailable (never a false alarm)", async () => {
    vi.stubGlobal("navigator", {});
    expect(await checkStorageStatus()).toEqual({ usageRatio: 0, low: false });
  });

  it("flags low storage once usage crosses the threshold", async () => {
    vi.stubGlobal("navigator", { storage: { estimate: async () => ({ usage: 90, quota: 100 }) } });
    const status = await checkStorageStatus();
    expect(status.low).toBe(true);
    expect(status.usageRatio).toBeCloseTo(0.9);
  });

  it("does not flag low storage comfortably under the threshold", async () => {
    vi.stubGlobal("navigator", { storage: { estimate: async () => ({ usage: 10, quota: 100 }) } });
    const status = await checkStorageStatus();
    expect(status.low).toBe(false);
  });

  it("trims every cached timeline date except today and every medications variant except current", async () => {
    await cacheTimeline(PROFILE_A, "2026-07-17", [{ slot: "morning" }]);
    await cacheTimeline(PROFILE_A, "2026-07-18", [{ slot: "night" }]);
    await cacheTimeline(PROFILE_A, "2026-07-19", [{ slot: "morning" }]);
    await cacheMedications(PROFILE_A, "current", [{ id: "a" }]);
    await cacheMedications(PROFILE_A, "all", [{ id: "a" }, { id: "b" }]);

    await trimToEssentials(PROFILE_A, "2026-07-19");

    expect(await getCachedTimeline(PROFILE_A, "2026-07-17")).toBeUndefined();
    expect(await getCachedTimeline(PROFILE_A, "2026-07-18")).toBeUndefined();
    expect((await getCachedTimeline(PROFILE_A, "2026-07-19"))?.items).toEqual([{ slot: "morning" }]);
    expect((await getCachedMedications(PROFILE_A, "current"))?.items).toEqual([{ id: "a" }]);
    expect(await getCachedMedications(PROFILE_A, "all")).toBeUndefined();
  });

  it("never touches another profile's cache while trimming", async () => {
    await cacheTimeline(PROFILE_A, "2026-07-17", [{ slot: "morning" }]);
    await cacheTimeline(PROFILE_B, "2026-07-17", [{ slot: "night" }]);
    await trimToEssentials(PROFILE_A, "2026-07-19");
    expect((await getCachedTimeline(PROFILE_B, "2026-07-17"))?.items).toEqual([{ slot: "night" }]);
  });

  it("never touches the mutation queue while trimming", async () => {
    await enqueueMutation(makeMutation());
    await trimToEssentials(PROFILE_A, "2026-07-19");
    expect(await pendingMutationCount()).toBe(1);
  });
});
