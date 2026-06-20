import React, { useEffect, useId, useRef } from "react";
import { Button } from "./Button";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirming?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  confirming = false,
  danger = false,
  onConfirm,
  onClose,
}: ConfirmModalProps): React.ReactElement | null {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const focusable = dialogRef.current?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    focusable?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !confirming) {
        onClose();
      }
      if (event.key !== "Tab") {
        return;
      }
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") ?? [])
        .filter((element) => !element.hasAttribute("disabled"));
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [confirming, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="ui-modal-backdrop" onMouseDown={() => !confirming && onClose()}>
      <div
        ref={dialogRef}
        className="ui-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        <div className="ui-modal-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={confirming}>Cancel</Button>
          <Button type="button" variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={confirming}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
