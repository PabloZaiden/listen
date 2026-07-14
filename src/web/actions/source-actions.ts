import type { SourceResponse } from "@listen/contracts";
import type { ActionMenuItem } from "@pablozaiden/webapp/web";

export type SourceActionContext = {
  source: SourceResponse;
  onRotate: (source: SourceResponse) => void;
  onDelete: (source: SourceResponse) => void;
};

export function buildSourceActions({ source, onRotate, onDelete }: SourceActionContext): ActionMenuItem[] {
  return [
    {
      id: "rotate-token",
      label: "Rotate token",
      onAction: () => onRotate(source),
    },
    {
      id: "delete",
      label: "Delete",
      destructive: true,
      onAction: () => onDelete(source),
    },
  ];
}
