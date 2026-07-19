import { useCallback, useEffect, useRef, useState } from "react";
import type { SourceMutationResponse, SourceResponse } from "@listen/contracts";
import { appJson, createLogger, useRealtimeRefresh, useToast } from "@pablozaiden/webapp/web";
import { mutationErrorMessage } from "../mutation-state";
import { reconcileCreatedSource, reconcileDeletedSource, reconcileRotatedSource, refreshSourceCollection } from "../source-state";

const log = createLogger("useSources");

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

type SourceRequest = {
  controller: AbortController;
  cleanup: () => void;
};

export function useSources(): SourcesController {
  const toast = useToast();
  const [sources, setSources] = useState<SourceResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();
  const activeRequestRef = useRef<SourceRequest | undefined>(undefined);

  const beginRequest = useCallback((signal?: AbortSignal): SourceRequest => {
    const previous = activeRequestRef.current;
    previous?.controller.abort();
    previous?.cleanup();

    const controller = new AbortController();
    let cleanup = (): void => {};
    if (signal?.aborted) {
      controller.abort();
    } else if (signal) {
      const onAbort = (): void => controller.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      cleanup = () => signal.removeEventListener("abort", onAbort);
    }

    const request = { controller, cleanup };
    activeRequestRef.current = request;
    return request;
  }, []);

  const ownsRequest = useCallback((request: SourceRequest): boolean => activeRequestRef.current === request, []);

  const finishRequest = useCallback((request: SourceRequest): boolean => {
    if (!ownsRequest(request)) return false;
    activeRequestRef.current = undefined;
    request.cleanup();
    return true;
  }, [ownsRequest]);

  const abortActiveRequest = useCallback((): void => {
    activeRequestRef.current?.controller.abort();
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setLoading(true);
    const request = beginRequest(signal);
    try {
      const response = await appJson<{ sources: SourceResponse[] }>("/api/sources", { signal: request.controller.signal });
      if (!ownsRequest(request) || request.controller.signal.aborted) return;
      setSources(response.sources);
      setError(undefined);
    } catch (requestError) {
      if (!ownsRequest(request) || request.controller.signal.aborted) return;
      const loadError = toSourceLoadError(requestError);
      setError(loadError);
      throw requestError;
    } finally {
      if (finishRequest(request)) setLoading(false);
    }
  }, [beginRequest, finishRequest, ownsRequest]);

  const refreshFromRealtime = useCallback(async (): Promise<void> => {
    await refreshSourceCollection(refresh, (requestError) => {
      toast.error(mutationErrorMessage(requestError, "Could not refresh sources."));
    });
  }, [refresh, toast]);

  useRealtimeRefresh({
    resources: ["sources"],
    refresh: refreshFromRealtime,
  });

  const createSource = useCallback(async (name: string): Promise<SourceMutationResponse> => {
    abortActiveRequest();
    const response = await appJson<SourceMutationResponse>("/api/sources", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    setSources((current) => reconcileCreatedSource(current, response.source));
    setError(undefined);
    return response;
  }, [abortActiveRequest]);

  const rotateSourceToken = useCallback(async (sourceId: string): Promise<SourceMutationResponse> => {
    abortActiveRequest();
    const response = await appJson<SourceMutationResponse>(`/api/sources/${encodeURIComponent(sourceId)}/token/rotate`, { method: "POST" });
    setSources((current) => reconcileRotatedSource(current, response.source));
    setError(undefined);
    return response;
  }, [abortActiveRequest]);

  const deleteSource = useCallback(async (sourceId: string): Promise<void> => {
    abortActiveRequest();
    await appJson(`/api/sources/${encodeURIComponent(sourceId)}`, { method: "DELETE" });
    setSources((current) => reconcileDeletedSource(current, sourceId));
    setError(undefined);
  }, [abortActiveRequest]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch((requestError) => {
      if (!controller.signal.aborted) {
        log.error("Could not load sources", requestError);
      }
    });
    return () => {
      controller.abort();
      const activeRequest = activeRequestRef.current;
      activeRequest?.controller.abort();
      activeRequest?.cleanup();
      activeRequestRef.current = undefined;
    };
  }, [refresh]);

  return { sources, loading, error, refresh, createSource, rotateSourceToken, deleteSource };
}
