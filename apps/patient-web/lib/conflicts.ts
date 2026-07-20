"use client";
import { useCallback, useEffect, useState } from "react";
import { dismissConflict, listConflicts, type StoredConflict } from "@medpass/offline-sync";
import { getActiveProfileId } from "./api";

/** Mutations a sync round-trip couldn't (fully) apply — docs/15 "needs your review". */
export function useConflicts() {
  const [items, setItems] = useState<StoredConflict[] | undefined>();

  const load = useCallback(async () => {
    setItems(await listConflicts(getActiveProfileId()));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, reload: load };
}

/** The patient has reviewed this conflict — accepts the server's version as-is. */
export async function resolveConflict(clientMutationId: string): Promise<void> {
  await dismissConflict(clientMutationId);
}
