import type { NotificationDetail, NotificationListItem, WebhookNotificationRequest } from "@listen/contracts";
import {
  deleteNotificationById,
  deleteNotifications as deletePersistedNotifications,
  getNotificationById,
  insertNotification,
  listNotifications as listPersistedNotifications,
  markNotificationOpened,
  type PersistedNotification,
} from "../persistence/notifications";
import { emit } from "./event-emitter";

function nowIso(): string {
  return new Date().toISOString();
}

export interface ListNotificationsOptions {
  sourceId?: string;
  limit: number;
  offset: number;
  opened?: boolean;
}

export interface ListNotificationsResult {
  notifications: NotificationListItem[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    nextOffset?: number;
  };
}

export function toNotificationListItem(notification: PersistedNotification): NotificationListItem {
  return {
    id: notification.id,
    title: notification.title,
    shortDescription: notification.shortDescription,
    source: notification.source,
    sourceId: notification.sourceId,
    icon: notification.icon,
    createdAt: notification.createdAt,
    openedAt: notification.openedAt,
  };
}

function toNotificationDetail(notification: PersistedNotification): NotificationDetail {
  if (!notification.openedAt) {
    throw new Error("Notification detail must be opened before serialization");
  }
  return {
    ...toNotificationListItem(notification),
    markdownContent: notification.markdownContent,
    openedAt: notification.openedAt,
  };
}

export function createNotificationFromWebhook(
  payload: WebhookNotificationRequest,
  source: { id: string; name: string },
): NotificationListItem {
  const notification: PersistedNotification = {
    id: crypto.randomUUID(),
    title: payload.title,
    shortDescription: payload.shortDescription,
    markdownContent: payload.markdownContent,
    sourceId: source.id,
    source: source.name,
    icon: payload.icon,
    createdAt: nowIso(),
  };
  insertNotification(notification);
  const item = toNotificationListItem(notification);
  emit({ type: "notification.created", notification: item });
  return item;
}

export function listNotifications(options: ListNotificationsOptions): ListNotificationsResult {
  const result = listPersistedNotifications(options);
  const nextOffset = options.offset + options.limit < result.total ? options.offset + options.limit : undefined;
  return {
    notifications: result.notifications.map(toNotificationListItem),
    pagination: {
      limit: options.limit,
      offset: options.offset,
      total: result.total,
      nextOffset,
    },
  };
}

export function openNotification(id: string): NotificationDetail | undefined {
  const existing = getNotificationById(id);
  if (!existing) {
    return undefined;
  }
  const opened = existing.openedAt ? existing : markNotificationOpened(id, nowIso());
  if (!opened) {
    return undefined;
  }
  if (!existing.openedAt) {
    emit({ type: "notification.opened", notification: toNotificationListItem(opened) });
  }
  return toNotificationDetail(opened);
}

export function deleteNotification(id: string): boolean {
  const existing = getNotificationById(id);
  if (!existing) {
    return false;
  }
  const deleted = deleteNotificationById(id);
  if (deleted) {
    emit({ type: "notification.deleted", notificationId: id, sourceId: existing.sourceId });
  }
  return deleted;
}

export function deleteNotifications(sourceId?: string): number {
  const deletedCount = deletePersistedNotifications(sourceId);
  emit({ type: "notifications.deleted", sourceId, deletedCount });
  return deletedCount;
}
