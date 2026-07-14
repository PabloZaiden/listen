import type { ActionMenuItem } from "@pablozaiden/webapp/web";

export type InboxActionContext = {
  markAllReadBusy: boolean;
  confirmBusy: boolean;
  onMarkAllRead: () => void;
  onDeleteAll: () => void;
};

export function buildInboxActions({
  markAllReadBusy,
  confirmBusy,
  onMarkAllRead,
  onDeleteAll,
}: InboxActionContext): ActionMenuItem[] {
  return [
    {
      id: "mark-all-read",
      label: markAllReadBusy ? "Marking as read..." : "Mark all as read",
      disabled: markAllReadBusy,
      onAction: onMarkAllRead,
    },
    {
      id: "delete-all",
      label: "Delete all",
      destructive: true,
      disabled: confirmBusy,
      onAction: onDeleteAll,
    },
  ];
}
