import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetDbHandleForTests } from "./db.js";
import {
  cacheMedications,
  cacheTimeline,
  clearAllOfflineData,
  clearProfileData,
  getCachedMedications,
  getCachedTimeline,
  getLastSynced,
  setLastSynced,
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
    endpoint: "/doses/x/events",
    ...overrides,
  };
}

beforeEach(() => {
  _resetDbHandleForTests();
});

afterEach(async () => {
  await clearAllOfflineData();
  _resetDbHandleForTests();
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
});
