import { useCallback, useRef, useState } from "react";

export type MutationKey = string;

export interface MutationGate {
  isActive: (key: MutationKey) => boolean;
  snapshot: () => ReadonlySet<MutationKey>;
  start: (key: MutationKey) => boolean;
  finish: (key: MutationKey) => boolean;
}

export function createMutationGate(): MutationGate {
  const activeKeys = new Set<MutationKey>();
  return {
    isActive: (key) => activeKeys.has(key),
    snapshot: () => new Set(activeKeys),
    start: (key) => {
      if (activeKeys.has(key)) return false;
      activeKeys.add(key);
      return true;
    },
    finish: (key) => activeKeys.delete(key),
  };
}

export function mutationErrorMessage(error: unknown, fallback = "The action could not be completed."): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

export type MutationRunResult<T> =
  | { started: true; value: T }
  | { started: false };

export async function runExclusiveMutation<T>(
  gate: MutationGate,
  key: MutationKey,
  action: () => Promise<T>,
): Promise<MutationRunResult<T>> {
  if (!gate.start(key)) return { started: false };
  try {
    return { started: true, value: await action() };
  } finally {
    gate.finish(key);
  }
}

export function useMutationTracker(): {
  activeKeys: ReadonlySet<MutationKey>;
  isBusy: (key: MutationKey) => boolean;
  start: (key: MutationKey) => boolean;
  finish: (key: MutationKey) => void;
} {
  const gateRef = useRef<MutationGate | undefined>(undefined);
  const gate = gateRef.current ?? (gateRef.current = createMutationGate());
  const [activeKeys, setActiveKeys] = useState<ReadonlySet<MutationKey>>(() => new Set());

  const start = useCallback((key: MutationKey): boolean => {
    if (!gate.start(key)) return false;
    setActiveKeys(gate.snapshot());
    return true;
  }, [gate]);

  const finish = useCallback((key: MutationKey): void => {
    if (!gate.finish(key)) return;
    setActiveKeys(gate.snapshot());
  }, [gate]);

  const isBusy = useCallback((key: MutationKey): boolean => activeKeys.has(key), [activeKeys]);

  return { activeKeys, isBusy, start, finish };
}
