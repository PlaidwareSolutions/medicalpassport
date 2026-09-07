"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@medpass/api-client";
import { api } from "./api";
import type { AnalytesDto, PatientLinkDto, ProposalDto, SnapshotDto } from "./types";

interface Loadable<T> {
  data?: T;
  error?: string;
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * What a 404 means depends on what was being opened. Every route on this
 * portal reads through a patient link, so "the link is closed" was the only
 * message — and an unknown proposal id, or a test vocabulary that failed to
 * load, said the patient had revoked something they had not. Each loader
 * names its own subject.
 */
const LINK_NOT_FOUND = "This patient link is no longer open — the patient may have revoked it or it expired.";

function describe(err: unknown, notFound: string = LINK_NOT_FOUND): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return notFound;
    return err.problem.title || "Something went wrong. Please try again.";
  }
  return "Could not reach the server. Check the connection and try again.";
}

function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[], notFound?: string): Loadable<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setData(await load());
    } catch (err) {
      setError(describe(err, notFound));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}

export function usePatients(): Loadable<PatientLinkDto[]> {
  return useLoad(async () => (await api.get<{ items: PatientLinkDto[] }>("/provider/patients")).items, []);
}

export function useSnapshot(linkId: string): Loadable<SnapshotDto> {
  return useLoad(() => api.get<SnapshotDto>(`/provider/patients/${encodeURIComponent(linkId)}/snapshot`), [linkId]);
}

export function useProposals(linkId: string): Loadable<ProposalDto[]> {
  return useLoad(async () => (await api.get<{ items: ProposalDto[] }>(`/provider/patients/${encodeURIComponent(linkId)}/proposals`)).items, [linkId]);
}

export function useProposal(id: string): Loadable<ProposalDto> {
  return useLoad(
    () => api.get<ProposalDto>(`/provider/proposals/${encodeURIComponent(id)}`),
    [id],
    "This proposal does not exist, or it was not sent by this organization. Open it from the patient's page.",
  );
}

export function useAnalytes(): Loadable<AnalytesDto> {
  return useLoad(() => api.get<AnalytesDto>("/terminology/analytes"), [], "The list of tests could not be loaded. Reload the page and try again.");
}

export function errorMessage(err: unknown): string {
  return describe(err);
}
