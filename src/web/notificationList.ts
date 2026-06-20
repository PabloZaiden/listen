import type { NotificationListItem } from "@listen/contracts";

export type InboxFilter = "all" | "unread" | "read";
export type NotificationGroupName = "Today" | "Yesterday" | "Older";

export interface NotificationGroup {
  name: NotificationGroupName;
  notifications: NotificationListItem[];
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function notificationGroupName(createdAt: string, now = new Date()): NotificationGroupName {
  const created = startOfDay(new Date(createdAt));
  const today = startOfDay(now);
  const diffDays = Math.floor((today.getTime() - created.getTime()) / 86_400_000);
  if (diffDays === 0) {
    return "Today";
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  return "Older";
}

export function notificationMatchesSearch(notification: NotificationListItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return [
    notification.title,
    notification.shortDescription,
    notification.source,
  ].some((value) => value.toLowerCase().includes(normalized));
}

export function groupNotifications(notifications: NotificationListItem[], now = new Date()): NotificationGroup[] {
  const groups: NotificationGroup[] = [
    { name: "Today", notifications: [] },
    { name: "Yesterday", notifications: [] },
    { name: "Older", notifications: [] },
  ];
  for (const notification of notifications) {
    groups.find((group) => group.name === notificationGroupName(notification.createdAt, now))?.notifications.push(notification);
  }
  return groups.filter((group) => group.notifications.length > 0);
}

export function filterNotifications(
  notifications: NotificationListItem[],
  options: { filter: InboxFilter; sourceId: string; search: string },
): NotificationListItem[] {
  return notifications.filter((notification) => {
    if (options.sourceId && notification.sourceId !== options.sourceId) {
      return false;
    }
    if (options.filter === "unread" && notification.openedAt) {
      return false;
    }
    if (options.filter === "read" && !notification.openedAt) {
      return false;
    }
    return notificationMatchesSearch(notification, options.search);
  });
}
