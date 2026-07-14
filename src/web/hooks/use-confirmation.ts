import { useCallback, useState } from "react";
import { useToast } from "@pablozaiden/webapp/web";
import { mutationErrorMessage } from "../mutation-state";

export type ConfirmState = {
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  successMessage?: string;
  action: () => Promise<void>;
};

export type ConfirmationController = {
  confirmState?: ConfirmState;
  confirmBusy: boolean;
  requestConfirm: (nextConfirmState: ConfirmState) => void;
  closeConfirm: () => void;
  runConfirm: () => Promise<void>;
};

export function useConfirmation(): ConfirmationController {
  const toast = useToast();
  const [confirmState, setConfirmState] = useState<ConfirmState>();
  const [confirmBusy, setConfirmBusy] = useState(false);

  const requestConfirm = useCallback((nextConfirmState: ConfirmState): void => {
    if (confirmBusy) return;
    setConfirmState(nextConfirmState);
  }, [confirmBusy]);

  const closeConfirm = useCallback((): void => {
    if (!confirmBusy) setConfirmState(undefined);
  }, [confirmBusy]);

  const runConfirm = useCallback(async (): Promise<void> => {
    const currentConfirmState = confirmState;
    if (!currentConfirmState || confirmBusy) return;
    setConfirmBusy(true);
    try {
      await currentConfirmState.action();
      setConfirmState(undefined);
      if (currentConfirmState.successMessage) {
        toast.success(currentConfirmState.successMessage);
      }
    } catch (error) {
      toast.error(mutationErrorMessage(error, "Could not complete this action."));
    } finally {
      setConfirmBusy(false);
    }
  }, [confirmBusy, confirmState, toast]);

  return { confirmState, confirmBusy, requestConfirm, closeConfirm, runConfirm };
}
