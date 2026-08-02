// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cacheKeyFor,
  clearMemoryCache,
  fetchDeduped,
  invalidate,
  isFresh,
  readEntry,
  writeEntry,
} from "./data-cache";

/**
 * The pure core of the stale-while-revalidate layer. The React hook on top is
 * covered by the Playwright instant-nav spec against the real app; these pin
 * the invariants the hook builds on — especially the profile-scoping that
 * docs/10 H-13 depends on.
 */

function stubActiveProfile(id: string | undefined) {
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => (k === "medpass_profile_id" ? (id ?? null) : null),
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  };
}

beforeEach(() => {
  clearMemoryCache();
  stubActiveProfile("profile-a");
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("key scoping", () => {
  it("keys profile data by the active profile, so another profile can never read it", () => {
    writeEntry(cacheKeyFor("profile", "/profiles/current/medications"), ["a-med"]);
    expect(readEntry(cacheKeyFor("profile", "/profiles/current/medications"))?.data).toEqual(["a-med"]);

    // The switch: profile B computes a different key and sees nothing.
    stubActiveProfile("profile-b");
    expect(readEntry(cacheKeyFor("profile", "/profiles/current/medications"))).toBeUndefined();
  });

  it("user-scoped data survives a profile switch — invitations are phone-scoped, not profile-scoped", () => {
    writeEntry(cacheKeyFor("user", "/caregivers/invitations"), ["invite"]);
    stubActiveProfile("profile-b");
    expect(readEntry(cacheKeyFor("user", "/caregivers/invitations"))?.data).toEqual(["invite"]);
  });
});

describe("isFresh / TTL", () => {
  it("ttl 0 is never fresh — medical data always revalidates", () => {
    const key = cacheKeyFor("profile", "/x");
    writeEntry(key, 1);
    expect(isFresh(key, 0)).toBe(false);
  });

  it("a recent entry is fresh inside a positive ttl, a missing one never is", () => {
    const key = cacheKeyFor("user", "/caregivers/invitations");
    expect(isFresh(key, 60_000)).toBe(false);
    writeEntry(key, []);
    expect(isFresh(key, 60_000)).toBe(true);
  });
});

describe("fetchDeduped", () => {
  it("N concurrent callers share one fetch, and write-through runs once", async () => {
    let fetches = 0;
    let writes = 0;
    const key = cacheKeyFor("profile", "/slow");
    const fetcher = async () => {
      fetches += 1;
      await new Promise((r) => setTimeout(r, 20));
      return "result";
    };
    const results = await Promise.all([
      fetchDeduped(key, fetcher, () => void (writes += 1)),
      fetchDeduped(key, fetcher, () => void (writes += 1)),
      fetchDeduped(key, fetcher, () => void (writes += 1)),
    ]);
    expect(results).toEqual(["result", "result", "result"]);
    expect(fetches).toBe(1);
    expect(writes).toBe(1);
    expect(readEntry(key)?.data).toBe("result");
  });

  it("a failed fetch clears the in-flight slot so the next attempt really retries", async () => {
    const key = cacheKeyFor("profile", "/flaky");
    let attempts = 0;
    await expect(
      fetchDeduped(key, async () => {
        attempts += 1;
        throw new Error("down");
      }),
    ).rejects.toThrow("down");
    await new Promise((r) => setTimeout(r, 0));
    await expect(fetchDeduped(key, async () => {
      attempts += 1;
      return "up";
    })).resolves.toBe("up");
    expect(attempts).toBe(2);
    // A failure writes nothing: stale-if-error is the hook's job, not the cache's.
    expect(readEntry(key)?.data).toBe("up");
  });
});

describe("invalidate", () => {
  it("drops entries by prefix within the scope, and in-flight requests with them", async () => {
    writeEntry(cacheKeyFor("profile", "/profiles/current/medications"), 1);
    writeEntry(cacheKeyFor("profile", "/profiles/current/medications?status=current"), 2);
    writeEntry(cacheKeyFor("profile", "/profiles/current/reports"), 3);
    const inflightKey = cacheKeyFor("profile", "/profiles/current/medications?x");
    const pending = fetchDeduped(inflightKey, async () => {
      await new Promise((r) => setTimeout(r, 30));
      return "late";
    });

    invalidate("profile", "/profiles/current/medications");

    expect(readEntry(cacheKeyFor("profile", "/profiles/current/medications"))).toBeUndefined();
    expect(readEntry(cacheKeyFor("profile", "/profiles/current/medications?status=current"))).toBeUndefined();
    expect(readEntry(cacheKeyFor("profile", "/profiles/current/reports"))?.data).toBe(3);

    // The invalidated in-flight promise was forgotten: a new fetch starts
    // fresh rather than adopting the stale one.
    let refetched = false;
    await fetchDeduped(inflightKey, async () => {
      refetched = true;
      return "fresh";
    });
    expect(refetched).toBe(true);
    await pending; // the old promise settles harmlessly
  });

  it("does not cross scopes — profile B's invalidation leaves A's entries alone", () => {
    writeEntry(cacheKeyFor("profile", "/profiles/current/medications"), "a-data");
    stubActiveProfile("profile-b");
    invalidate("profile", "/profiles/current/medications");
    stubActiveProfile("profile-a");
    expect(readEntry(cacheKeyFor("profile", "/profiles/current/medications"))?.data).toBe("a-data");
  });
});

describe("capacity and purge", () => {
  it("evicts the oldest entry past the cap instead of growing forever", () => {
    for (let i = 0; i < 205; i += 1) writeEntry(`user|/n/${i}`, i);
    expect(readEntry("user|/n/0")).toBeUndefined();
    expect(readEntry("user|/n/204")?.data).toBe(204);
  });

  it("clearMemoryCache empties everything — the sign-out guarantee", () => {
    writeEntry(cacheKeyFor("profile", "/a"), 1);
    writeEntry(cacheKeyFor("user", "/b"), 2);
    clearMemoryCache();
    expect(readEntry(cacheKeyFor("profile", "/a"))).toBeUndefined();
    expect(readEntry(cacheKeyFor("user", "/b"))).toBeUndefined();
  });
});
