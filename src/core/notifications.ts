import type { NotificationDetail, NotificationListItem, WebhookNotificationRequest } from "@listen/contracts";
import {
  deleteNotificationById,
  deleteNotifications as deletePersistedNotifications,
  getNotificationById,
  insertNotification,
  listNotifications as listPersistedNotifications,
  markNotificationRead as markPersistedNotificationRead,
  markNotificationUnread as markPersistedNotificationUnread,
  markNotificationsRead as markPersistedNotificationsRead,
  markNotificationOpened,
  countUnreadNotifications,
  type PersistedNotification,
} from "../persistence/notifications";
import { sendBrowserPushNotification } from "./browser-push";
import { emit } from "./event-emitter";
import { createLogger, errorLogFields } from "./logger";

const log = createLogger("notifications");

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
  unreadCount: number;
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
  options: { publicOrigin: string },
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
  const unreadCount = getUnreadNotificationCount();
  emit({ type: "notification.created", notification: item, unreadCount });
  log.info("Notification created", { notificationId: item.id, sourceId: item.sourceId, source: item.source });
  void sendBrowserPushNotification(item, unreadCount, options.publicOrigin).catch((error) => {
    log.warn("Browser push notification fanout failed", { notificationId: item.id, sourceId: item.sourceId, ...errorLogFields(error) });
  });
  return item;
}

export function getUnreadNotificationCount(): number {
  return countUnreadNotifications();
}

export function listNotifications(options: ListNotificationsOptions): ListNotificationsResult {
  const result = listPersistedNotifications(options);
  const nextOffset = options.offset + options.limit < result.total ? options.offset + options.limit : undefined;
  return {
    notifications: result.notifications.map(toNotificationListItem),
    unreadCount: getUnreadNotificationCount(),
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
    log.warn("Notification open requested but notification was not found", { notificationId: id });
    return undefined;
  }
  const opened = existing.openedAt ? existing : markNotificationOpened(id, nowIso());
  if (!opened) {
    log.warn("Notification open update failed after lookup", { notificationId: id });
    return undefined;
  }
  if (!existing.openedAt) {
    emit({ type: "notification.opened", notification: toNotificationListItem(opened), unreadCount: getUnreadNotificationCount() });
    log.info("Notification opened", { notificationId: id, sourceId: opened.sourceId });
  }
  return toNotificationDetail(opened);
}

export function deleteNotification(id: string): boolean {
  const existing = getNotificationById(id);
  if (!existing) {
    log.warn("Notification delete requested but notification was not found", { notificationId: id });
    return false;
  }
  const deleted = deleteNotificationById(id);
  if (deleted) {
    emit({ type: "notification.deleted", notificationId: id, sourceId: existing.sourceId, unreadCount: getUnreadNotificationCount() });
    log.info("Notification deleted", { notificationId: id, sourceId: existing.sourceId });
  }
  return deleted;
}

export function deleteNotifications(sourceId?: string): number {
  const deletedCount = deletePersistedNotifications(sourceId);
  emit({ type: "notifications.deleted", sourceId, deletedCount, unreadCount: getUnreadNotificationCount() });
  log.info("Notifications deleted", { sourceId, deletedCount });
  return deletedCount;
}

export function markNotificationRead(id: string): NotificationListItem | undefined {
  const existing = getNotificationById(id);
  if (!existing) {
    log.warn("Notification read requested but notification was not found", { notificationId: id });
    return undefined;
  }
  const read = markPersistedNotificationRead(id, nowIso());
  if (!read) {
    log.warn("Notification read update failed after lookup", { notificationId: id });
    return undefined;
  }
  const item = toNotificationListItem(read);
  emit({ type: "notification.opened", notification: item, unreadCount: getUnreadNotificationCount() });
  log.info("Notification marked read", { notificationId: id, sourceId: item.sourceId });
  return item;
}

export function markNotificationUnread(id: string): NotificationListItem | undefined {
  const existing = getNotificationById(id);
  if (!existing) {
    log.warn("Notification unread requested but notification was not found", { notificationId: id });
    return undefined;
  }
  const unread = markPersistedNotificationUnread(id);
  if (!unread) {
    log.warn("Notification unread update failed after lookup", { notificationId: id });
    return undefined;
  }
  const item = toNotificationListItem(unread);
  emit({ type: "notification.opened", notification: item, unreadCount: getUnreadNotificationCount() });
  log.info("Notification marked unread", { notificationId: id, sourceId: item.sourceId });
  return item;
}

export function markNotificationsRead(sourceId?: string): number {
  const updatedCount = markPersistedNotificationsRead({ sourceId, opened: false }, nowIso());
  emit({ type: "notifications.opened", sourceId, updatedCount, unreadCount: getUnreadNotificationCount() });
  log.info("Notifications marked read", { sourceId, updatedCount });
  return updatedCount;
}
