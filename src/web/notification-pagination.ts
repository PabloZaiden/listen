import type { NotificationListItem } from "@listen/contracts";

export interface NotificationListResponse {
  notifications: NotificationListItem[];
  unreadCount: number;
  pagination: {
    limit: number;
    offset: number;
    total: number;
    nextOffset?: number;
  };
}

export interface NotificationCollectionState {
  sourceId?: string;
  notifications: NotificationListItem[];
  unreadCount: number;
  total: number;
  loadedThrough: number;
  nextOffset?: number;
}

export function compareNotificationOrder(left: NotificationListItem, right: NotificationListItem): number {
  const createdAtOrder = right.createdAt.localeCompare(left.createdAt);
  return createdAtOrder || right.id.localeCompare(left.id);
}

function pageEnd(response: NotificationListResponse): number {
  return Math.min(response.pagination.total, response.pagination.offset + response.pagination.limit);
}

function continuationOffset(response: NotificationListResponse, loadedThrough: number): number | undefined {
  const responseNextOffset = response.pagination.nextOffset;
  const nextOffset = Math.max(loadedThrough, responseNextOffset ?? 0);
  return nextOffset < response.pagination.total ? nextOffset : undefined;
}

export function createNotificationCollectionState(
  response: NotificationListResponse,
  sourceId?: string,
): NotificationCollectionState {
  return mergeNotificationPage({
    sourceId,
    notifications: [],
    unreadCount: response.unreadCount,
    total: 0,
    loadedThrough: 0,
  }, response);
}

export function mergeNotificationPage(
  state: NotificationCollectionState,
  response: NotificationListResponse,
): NotificationCollectionState {
  const notificationsById = new Map(state.notifications.map((notification) => [notification.id, notification]));
  for (const notification of response.notifications) {
    notificationsById.set(notification.id, notification);
  }
  const notifications = [...notificationsById.values()].sort(compareNotificationOrder);
  const loadedThrough = Math.max(state.loadedThrough, pageEnd(response));
  return {
    sourceId: state.sourceId,
    notifications,
    unreadCount: response.unreadCount,
    total: response.pagination.total,
    loadedThrough,
    nextOffset: continuationOffset(response, loadedThrough),
  };
}

export function replaceNotification(
  state: NotificationCollectionState,
  notification: NotificationListItem,
): NotificationCollectionState {
  const previous = state.notifications.find((existing) => existing.id === notification.id);
  if (!previous) return state;
  const unreadChange = Number(!notification.readAt) - Number(!previous.readAt);
  return {
    ...state,
    unreadCount: Math.max(0, state.unreadCount + unreadChange),
    notifications: state.notifications
      .map((existing) => existing.id === notification.id ? notification : existing)
      .sort(compareNotificationOrder),
  };
}

export function removeNotification(
  state: NotificationCollectionState,
  notificationId: string,
): NotificationCollectionState {
  const previous = state.notifications.find((notification) => notification.id === notificationId);
  if (!previous) return state;
  const total = Math.max(0, state.total - 1);
  const loadedThrough = Math.max(0, state.loadedThrough - 1);
  return {
    ...state,
    notifications: state.notifications.filter((notification) => notification.id !== notificationId),
    unreadCount: Math.max(0, state.unreadCount - Number(!previous.readAt)),
    total,
    loadedThrough,
    nextOffset: loadedThrough < total ? loadedThrough : undefined,
  };
}
