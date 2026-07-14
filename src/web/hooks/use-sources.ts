import { useCallback, useEffect, useState } from "react";
import type { SourceMutationResponse, SourceResponse } from "@listen/contracts";
import { appJson } from "@pablozaiden/webapp/web";

export type SourcesController = {
  sources: SourceResponse[];
  loading: boolean;
  error?: Error;
  refresh: (signal?: AbortSignal) => Promise<void>;
  createSource: (name: string) => Promise<SourceMutationResponse>;
  rotateSourceToken: (sourceId: string) => Promise<SourceMutationResponse>;
  deleteSource: (sourceId: string) => Promise<void>;
};

function toSourceLoadError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Could not load sources");
}

export function useSources(): SourcesController {
  const [sources, setSources] = useState<SourceResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setLoading(true);
    try {
      const response = await appJson<{ sources: SourceResponse[] }>("/api/sources", { signal });
      if (signal?.aborted) return;
      setSources(response.sources);
      setError(undefined);
    } catch (requestError) {
      if (signal?.aborted) return;
      const loadError = toSourceLoadError(requestError);
      setError(loadError);
      throw requestError;
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const createSource = useCallback(async (name: string): Promise<SourceMutationResponse> => {
    const response = await appJson<SourceMutationResponse>("/api/sources", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    setSources((current) => [response.source, ...current.filter((source) => source.id !== response.source.id)]);
    setError(undefined);
    return response;
  }, []);

  const rotateSourceToken = useCallback(async (sourceId: string): Promise<SourceMutationResponse> => {
    const response = await appJson<SourceMutationResponse>(`/api/sources/${encodeURIComponent(sourceId)}/token/rotate`, { method: "POST" });
    setSources((current) => current.map((source) => source.id === response.source.id ? response.source : source));
    setError(undefined);
    return response;
  }, []);

  const deleteSource = useCallback(async (sourceId: string): Promise<void> => {
    await appJson(`/api/sources/${encodeURIComponent(sourceId)}`, { method: "DELETE" });
    setSources((current) => current.filter((source) => source.id !== sourceId));
    setError(undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch((requestError) => {
      if (!controller.signal.aborted) {
        console.error("Could not load sources", requestError);
      }
    });
    return () => controller.abort();
  }, [refresh]);

  return { sources, loading, error, refresh, createSource, rotateSourceToken, deleteSource };
}
