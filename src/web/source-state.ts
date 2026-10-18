import type { SourceMutationResponse, SourceResponse } from "@listen/contracts";

export function reconcileCreatedSource(current: SourceResponse[], source: SourceMutationResponse["source"]): SourceResponse[] {
  return [source, ...current.filter((candidate) => candidate.id !== source.id)];
}

export function reconcileRotatedSource(current: SourceResponse[], source: SourceMutationResponse["source"]): SourceResponse[] {
  return current.map((candidate) => candidate.id === source.id ? source : candidate);
}

export function reconcileDeletedSource(current: SourceResponse[], sourceId: string): SourceResponse[] {
  return current.filter((source) => source.id !== sourceId);
}
