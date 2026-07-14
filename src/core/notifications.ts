import type { NotificationDetail, NotificationListItem, WebhookNotificationRequest } from "@listen/contracts";
import { requireUserId } from "@listen/shared";
import {
  deleteNotificationById,
  deleteNotifications as deletePersistedNotifications,
  getNotificationById,
  insertNotification,
  listNotifications as listPersistedNotifications,
  markNotificationRead as markPersistedNotificationRead,
  markNotificationUnread as markPersistedNotificationUnread,
  markNotificationsRead as markPersistedNotificationsRead,
  countUnreadNotifications,
  type PersistedNotification,
} from "../persistence/notifications";
import { sendBrowserPushNotification } from "./browser-push";
import { createLogger, errorLogFields } from "./logger";

const log = createLogger("notifications");

function nowIso(): string {
  return new Date().toISOString();
}

export interface ListNotificationsOptions {
  userId: string;
  sourceId?: string;
  limit: number;
  offset: number;
  read?: boolean;
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
    readAt: notification.readAt,
  };
}

function toNotificationDetail(notification: PersistedNotification): NotificationDetail {
  if (!notification.readAt) {
    throw new Error("Notification detail must be read before serialization");
  }
  return {
    ...toNotificationListItem(notification),
    markdownContent: notification.markdownContent,
    readAt: notification.readAt,
  };
}

export function createNotificationFromWebhook(
  payload: WebhookNotificationRequest,
  source: { id: string; name: string; userId: string },
  options: { publicOrigin: string },
): NotificationListItem {
  const ownerId = requireUserId(source.userId);
  const notification: PersistedNotification = {
    id: crypto.randomUUID(),
    userId: ownerId,
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
  const unreadCount = getUnreadNotificationCount(ownerId);
  log.info("Notification created", { notificationId: item.id, sourceId: item.sourceId, source: item.source });
  void sendBrowserPushNotification(item, unreadCount, options.publicOrigin, ownerId).catch((error) => {
    log.warn("Browser push notification fanout failed", { notificationId: item.id, sourceId: item.sourceId, userId: ownerId, ...errorLogFields(error) });
  });
  return item;
}

export function getUnreadNotificationCount(userId: string): number {
  return countUnreadNotifications(requireUserId(userId));
}

export function listNotifications(options: ListNotificationsOptions): ListNotificationsResult {
  const result = listPersistedNotifications(options);
  const nextOffset = options.offset + options.limit < result.total ? options.offset + options.limit : undefined;
  return {
    notifications: result.notifications.map(toNotificationListItem),
    unreadCount: getUnreadNotificationCount(options.userId),
    pagination: {
      limit: options.limit,
      offset: options.offset,
      total: result.total,
      nextOffset,
    },
  };
}

/**
 * Fetching notification detail marks an unread notification as read.
 * The readAt field is the persisted/public read timestamp.
 */
export function getNotificationDetail(id: string, userId: string): NotificationDetail | undefined {
  const ownerId = requireUserId(userId);
  const read = markPersistedNotificationRead(id, nowIso(), ownerId);
  if (!read) {
    log.warn("Notification open requested but notification was not found", { notificationId: id });
    return undefined;
  }
  return toNotificationDetail(read);
}

export function deleteNotification(id: string, userId: string): boolean {
  const ownerId = requireUserId(userId);
  const existing = getNotificationById(id, ownerId);
  if (!existing) {
    log.warn("Notification delete requested but notification was not found", { notificationId: id });
    return false;
  }
  const deleted = deleteNotificationById(id, ownerId);
  if (deleted) {
    log.info("Notification deleted", { notificationId: id, sourceId: existing.sourceId });
  }
  return deleted;
}

export function deleteNotifications(options: { userId: string; sourceId?: string; read?: boolean }): number {
  const ownerId = requireUserId(options.userId);
  const deletedCount = deletePersistedNotifications({ ...options, userId: ownerId });
  log.info("Notifications deleted", { sourceId: options.sourceId, read: options.read, deletedCount });
  return deletedCount;
}

export function markNotificationRead(id: string, userId: string): NotificationListItem | undefined {
  const ownerId = requireUserId(userId);
  const existing = getNotificationById(id, ownerId);
  if (!existing) {
    log.warn("Notification read requested but notification was not found", { notificationId: id });
    return undefined;
  }
  if (existing.readAt) {
    return toNotificationListItem(existing);
  }
  const read = markPersistedNotificationRead(id, nowIso(), ownerId);
  if (!read) {
    log.warn("Notification read update failed after lookup", { notificationId: id });
    return undefined;
  }
  const item = toNotificationListItem(read);
  log.info("Notification marked read", { notificationId: id, sourceId: item.sourceId });
  return item;
}

export function markNotificationUnread(id: string, userId: string): NotificationListItem | undefined {
  const ownerId = requireUserId(userId);
  const existing = getNotificationById(id, ownerId);
  if (!existing) {
    log.warn("Notification unread requested but notification was not found", { notificationId: id });
    return undefined;
  }
  if (!existing.readAt) {
    return toNotificationListItem(existing);
  }
  const unread = markPersistedNotificationUnread(id, ownerId);
  if (!unread) {
    log.warn("Notification unread update failed after lookup", { notificationId: id });
    return undefined;
  }
  const item = toNotificationListItem(unread);
  log.info("Notification marked unread", { notificationId: id, sourceId: item.sourceId });
  return item;
}

export function markNotificationsRead(userId: string, sourceId?: string): number {
  const ownerId = requireUserId(userId);
  const updatedCount = markPersistedNotificationsRead({ userId: ownerId, sourceId, read: false }, nowIso());
  log.info("Notifications marked read", { sourceId, updatedCount });
  return updatedCount;
}
