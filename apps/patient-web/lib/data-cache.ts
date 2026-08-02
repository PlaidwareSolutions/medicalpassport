"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@medpass/api-client";
import { getActiveProfileId } from "./api";

/**
 * A session-lifetime stale-while-revalidate cache shared by the data hooks.
 *
 * Why this exists: every screen's hooks used to fetch on mount with nothing
 * shared between them, so each navigation showed a spinner until the network
 * answered — even for data fetched seconds earlier. Now the last known data
 * renders instantly and the refresh happens behind it. Freshness is not
 * traded away: with the default `ttlMs: 0` every mount still revalidates;
 * only the render stops waiting for it.
 *
 * Deliberately not a store: entries are plain snapshots, there are no
 * subscriptions, and two simultaneously-mounted consumers of one key are not
 * live-synced (same as before this cache existed). Keys are scoped by
 * profile id, which is what makes a profile switch safe (docs/10 H-13): the
 * switched-to profile can only ever read its own keys, and the page tree is
 * remounted by ProfileKeyedContent anyway.
 */

interface Entry {
  data: unknown;
  updatedAt: number;
}

/** Insertion-order cap — payloads here are small lists; this is a guard, not an LRU. */
const MAX_ENTRIES = 200;

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export type CacheScope = "profile" | "user";

function scopePrefix(scope: CacheScope): string {
  // "user" data (e.g. invitations, keyed to the phone number) must survive a
  // profile switch; profile data must never leak across one.
  return scope === "user" ? "user" : (getActiveProfileId() ?? "anon");
}

export function cacheKeyFor(scope: CacheScope, path: string): string {
  return `${scopePrefix(scope)}|${path}`;
}

export function readEntry<T>(key: string): { data: T; updatedAt: number } | undefined {
  const entry = entries.get(key);
  return entry ? { data: entry.data as T, updatedAt: entry.updatedAt } : undefined;
}

export function writeEntry(key: string, data: unknown): void {
  if (!entries.has(key) && entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  entries.delete(key); // re-insert to refresh insertion order
  entries.set(key, { data, updatedAt: Date.now() });
}

/**
 * Drops every entry and in-flight request whose key falls under the prefix.
 * Mutating helpers call this so a later navigation can't render data that is
 * known to be stale (docs/12 H-12) — the cost is one honest spinner there.
 */
export function invalidate(scope: CacheScope, pathPrefix: string): void {
  const prefix = `${scopePrefix(scope)}|${pathPrefix}`;
  for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
  for (const key of inflight.keys()) if (key.startsWith(prefix)) inflight.delete(key);
}

/** Sign-out / session revocation: cached PHI must not outlive the session. */
export function clearMemoryCache(): void {
  entries.clear();
  inflight.clear();
}

/** Whether the entry is inside its TTL. ttlMs 0 (the default) is never fresh — always revalidate. */
export function isFresh(key: string, ttlMs: number): boolean {
  const entry = entries.get(key);
  return entry !== undefined && ttlMs > 0 && Date.now() - entry.updatedAt < ttlMs;
}

/**
 * The dedupe core: concurrent callers of one key share a single fetch, and
 * the durable write-through runs once, inside the shared promise.
 */
export function fetchDeduped<T>(key: string, fetcher: () => Promise<T>, onFetched?: (data: T) => void | Promise<void>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = (async () => {
    const fetched = await fetcher();
    writeEntry(key, fetched);
    await onFetched?.(fetched);
    return fetched;
  })();
  inflight.set(key, p);
  void p.catch(() => undefined).then(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  return p;
}

export interface SharedResourceOptions<T> {
  /** Includes the query string; forms the cache key together with the scope. */
  path: string;
  /** The existing api.get call, unchanged — 401→refresh retry happens inside it. */
  fetcher: () => Promise<T>;
  scope?: CacheScope;
  /** 0 (default) = always revalidate on mount. Non-zero only for low-stakes data. */
  ttlMs?: number;
  /** Cold-start read from IndexedDB, raced against the network; never overwrites a network result. */
  seed?: () => Promise<T | undefined>;
  /** Network-failure read from IndexedDB — the docs/15 offline path, semantics unchanged. */
  fallback?: () => Promise<T | undefined>;
  /** Durable write-through (IndexedDB); runs once per fetch inside the shared promise. */
  onFetched?: (data: T) => void | Promise<void>;
  /** Maps an ApiError to data instead of an error (e.g. a caregiver's 403 → empty list). */
  mapApiError?: (err: ApiError) => T | undefined;
}

export interface SharedResource<T> {
  data: T | undefined;
  error: string | undefined;
  /** True only on the network-failure fallback path — drives the offline banner. */
  fromCache: boolean;
  /** Forces past the TTL. */
  reload: () => Promise<void>;
  /** Local optimistic update (e.g. a recorded dose) — also writes the shared entry. */
  mutate: (data: T) => void;
}

export function useSharedResource<T>(opts: SharedResourceOptions<T>): SharedResource<T> {
  const scope = opts.scope ?? "profile";
  const key = cacheKeyFor(scope, opts.path);

  // Latest-ref for the callbacks so callers can pass inline closures without
  // retriggering the mount effect; only the key identity re-runs it.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [data, setData] = useState<T | undefined>(() => readEntry<T>(key)?.data);
  const [error, setError] = useState<string | undefined>();
  const [fromCache, setFromCache] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (force: boolean) => {
      const current = optsRef.current;
      // Key captured now: a slow response landing after a profile switch
      // writes only under the profile it was fetched for.
      const loadKey = cacheKeyFor(scope, current.path);
      const existing = readEntry<T>(loadKey);
      if (!force && isFresh(loadKey, current.ttlMs ?? 0)) {
        return; // fresh enough — no network
      }
      if (mountedRef.current) setError(undefined);

      let settled = false;

      // Cold-start seed: only useful when memory has nothing yet. Raced, and
      // guarded so it can never clobber the network result.
      if (!existing && current.seed) {
        void current.seed().then((seeded) => {
          if (seeded !== undefined && !settled && mountedRef.current && loadKey === cacheKeyFor(scope, optsRef.current.path)) {
            setData(seeded);
          }
        });
      }

      try {
        const fetched = await fetchDeduped(loadKey, current.fetcher, current.onFetched);
        settled = true;
        if (!mountedRef.current || loadKey !== cacheKeyFor(scope, optsRef.current.path)) return;
        setData(fetched);
        setFromCache(false);
      } catch (err) {
        settled = true;
        if (!mountedRef.current || loadKey !== cacheKeyFor(scope, optsRef.current.path)) return;
        if (err instanceof ApiError) {
          const mapped = current.mapApiError?.(err);
          if (mapped !== undefined) {
            setData(mapped);
            setFromCache(false);
            return;
          }
          setError(err.problem.title);
          return;
        }
        // Genuine network failure — the docs/15 offline path. Fallback data is
        // deliberately NOT written to the memory cache: it must never be
        // served later as if it were fresh.
        const fallbackData = await current.fallback?.();
        if (fallbackData !== undefined) {
          setData(fallbackData);
          setFromCache(true);
          return;
        }
        if (readEntry<T>(loadKey) !== undefined || existing !== undefined) {
          // Memory data is already showing; keep it, but be honest that the
          // refresh failed (the offline banner keys off this).
          setFromCache(true);
          return;
        }
        setError("network");
      }
    },
    [scope, key], // eslint-disable-line react-hooks/exhaustive-deps -- key encodes path+scope; callbacks via optsRef
  );

  useEffect(() => {
    // Re-read on key change (profile switch remount lands here too).
    setData(readEntry<T>(key)?.data);
    setFromCache(false);
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = useCallback(() => load(true), [load]);
  const mutate = useCallback(
    (next: T) => {
      writeEntry(cacheKeyFor(scope, optsRef.current.path), next);
      setData(next);
    },
    [scope],
  );

  return { data, error, fromCache, reload, mutate };
}
