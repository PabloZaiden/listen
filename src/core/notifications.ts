import type { NotificationDetail, NotificationListItem, WebhookNotificationRequest } from "@listen/contracts";
import { getOwner, requireOwner, type OwnerAccount } from "../persistence/account";
import { createLogger } from "@pablozaiden/webapp/server";
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
import { errorLogFields } from "./log-fields";

const log = createLogger("notifications");

function nowIso(): string {
  return new Date().toISOString();
}

export interface ListNotificationsOptions {
  owner: OwnerAccount;
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
  const owner = getOwner();
  if (!owner || owner.id !== source.userId) throw new Error("Webhook source does not belong to the Listen owner");
  const ownerId = requireOwner(owner);
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
  insertNotification(notification, owner);
  const item = toNotificationListItem(notification);
  const unreadCount = getUnreadNotificationCount(owner);
  log.info("Notification created", { notificationId: item.id, sourceId: item.sourceId, source: item.source });
  void sendBrowserPushNotification(item, unreadCount, options.publicOrigin, owner).catch((error) => {
    log.warn("Browser push notification fanout failed", { notificationId: item.id, sourceId: item.sourceId, userId: ownerId, ...errorLogFields(error) });
  });
  return item;
}

export function getUnreadNotificationCount(owner: OwnerAccount): number {
  return countUnreadNotifications(owner);
}

export function listNotifications(options: ListNotificationsOptions): ListNotificationsResult {
  const result = listPersistedNotifications(options);
  const nextOffset = options.offset + options.limit < result.total ? options.offset + options.limit : undefined;
  return {
    notifications: result.notifications.map(toNotificationListItem),
    unreadCount: getUnreadNotificationCount(options.owner),
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
export function getNotificationDetail(id: string, owner: OwnerAccount): NotificationDetail | undefined {
  const read = markPersistedNotificationRead(id, nowIso(), owner);
  if (!read) {
    log.warn("Notification open requested but notification was not found", { notificationId: id });
    return undefined;
  }
  return toNotificationDetail(read);
}

export function deleteNotification(id: string, owner: OwnerAccount): boolean {
  const existing = getNotificationById(id, owner);
  if (!existing) {
    log.warn("Notification delete requested but notification was not found", { notificationId: id });
    return false;
  }
  const deleted = deleteNotificationById(id, owner);
  if (deleted) {
    log.info("Notification deleted", { notificationId: id, sourceId: existing.sourceId });
  }
  return deleted;
}

export function deleteNotifications(options: { owner: OwnerAccount; sourceId?: string; read?: boolean }): number {
  const deletedCount = deletePersistedNotifications(options);
  log.info("Notifications deleted", { sourceId: options.sourceId, read: options.read, deletedCount });
  return deletedCount;
}

export function markNotificationRead(id: string, owner: OwnerAccount): NotificationListItem | undefined {
  const existing = getNotificationById(id, owner);
  if (!existing) {
    log.warn("Notification read requested but notification was not found", { notificationId: id });
    return undefined;
  }
  if (existing.readAt) {
    return toNotificationListItem(existing);
  }
  const read = markPersistedNotificationRead(id, nowIso(), owner);
  if (!read) {
    log.warn("Notification read update failed after lookup", { notificationId: id });
    return undefined;
  }
  const item = toNotificationListItem(read);
  log.info("Notification marked read", { notificationId: id, sourceId: item.sourceId });
  return item;
}

export function markNotificationUnread(id: string, owner: OwnerAccount): NotificationListItem | undefined {
  const existing = getNotificationById(id, owner);
  if (!existing) {
    log.warn("Notification unread requested but notification was not found", { notificationId: id });
    return undefined;
  }
  if (!existing.readAt) {
    return toNotificationListItem(existing);
  }
  const unread = markPersistedNotificationUnread(id, owner);
  if (!unread) {
    log.warn("Notification unread update failed after lookup", { notificationId: id });
    return undefined;
  }
  const item = toNotificationListItem(unread);
  log.info("Notification marked unread", { notificationId: id, sourceId: item.sourceId });
  return item;
}

export function markNotificationsRead(owner: OwnerAccount, sourceId?: string): number {
  const updatedCount = markPersistedNotificationsRead({ owner, sourceId, read: false }, nowIso());
  log.info("Notifications marked read", { sourceId, updatedCount });
  return updatedCount;
}
