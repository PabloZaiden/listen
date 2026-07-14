import type { ActionMenuItem } from "@pablozaiden/webapp/web";
import type { ConfirmState } from "../hooks/use-confirmation";

export type NotificationActionContext = {
  id: string;
  markUnreadBusy: boolean;
  confirmBusy: boolean;
  onMarkUnread: () => void;
  onDelete: () => void;
};

export function buildNotificationActions({
  id,
  markUnreadBusy,
  confirmBusy,
  onMarkUnread,
  onDelete,
}: NotificationActionContext): ActionMenuItem[] {
  return [
    {
      id: "mark-unread",
      label: markUnreadBusy ? "Marking as unread..." : "Mark as unread",
      disabled: !id || markUnreadBusy,
      onAction: onMarkUnread,
    },
    {
      id: "delete",
      label: "Delete",
      destructive: true,
      disabled: confirmBusy,
      onAction: onDelete,
    },
  ];
}

export type NotificationDeleteConfirmationContext = {
  requestConfirm: (confirm: ConfirmState) => void;
  deleteNotification: (notificationId: string) => Promise<void>;
  onDeleted: () => void | Promise<void>;
};

export function requestNotificationDelete(
  notificationId: string,
  context: NotificationDeleteConfirmationContext,
): void {
  context.requestConfirm({
    title: "Delete notification?",
    description: "This notification will be permanently removed.",
    confirmLabel: "Delete notification",
    danger: true,
    successMessage: "Notification deleted.",
    action: async () => {
      await context.deleteNotification(notificationId);
      await context.onDeleted();
    },
  });
}
