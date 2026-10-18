import { useCallback } from "react";
import type { SourceMutationResponse, SourceResponse } from "@listen/contracts";
import { appJson, useLiveQuery } from "@pablozaiden/webapp/web";
import { reconcileCreatedSource, reconcileDeletedSource, reconcileRotatedSource } from "../source-state";

export type SourcesController = {
  sources: SourceResponse[];
  loading: boolean;
  error?: Error;
  refresh: () => Promise<void>;
  createSource: (name: string) => Promise<SourceMutationResponse>;
  rotateSourceToken: (sourceId: string) => Promise<SourceMutationResponse>;
  deleteSource: (sourceId: string) => Promise<void>;
};

export function useSources(): SourcesController {
  const { data, loading, error, refresh, mutate } = useLiveQuery<SourceResponse[]>({
    load: async (signal) => {
      const response = await appJson<{ sources: SourceResponse[] }>("/api/sources", { signal });
      return response.sources;
    },
    realtime: { resources: ["sources"] },
  });

  const createSource = useCallback(async (name: string): Promise<SourceMutationResponse> => {
    return mutate(
      (signal) => appJson<SourceMutationResponse>("/api/sources", {
        method: "POST",
        body: JSON.stringify({ name }),
        signal,
      }),
      (current, response) => reconcileCreatedSource(current ?? [], response.source),
    );
  }, [mutate]);

  const rotateSourceToken = useCallback(async (sourceId: string): Promise<SourceMutationResponse> => {
    return mutate(
      (signal) => appJson<SourceMutationResponse>(`/api/sources/${encodeURIComponent(sourceId)}/token/rotate`, { method: "POST", signal }),
      (current, response) => reconcileRotatedSource(current ?? [], response.source),
    );
  }, [mutate]);

  const deleteSource = useCallback(async (sourceId: string): Promise<void> => {
    await mutate(
      (signal) => appJson(`/api/sources/${encodeURIComponent(sourceId)}`, { method: "DELETE", signal }),
      (current) => reconcileDeletedSource(current ?? [], sourceId),
    );
  }, [mutate]);

  return { sources: data ?? [], loading, error, refresh, createSource, rotateSourceToken, deleteSource };
}
