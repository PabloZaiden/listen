import { getDatabase } from "./database";
import { requireOwner, type OwnerAccount } from "./account";

export interface PersistedNotification {
  id: string;
  userId: string;
  title: string;
  shortDescription: string;
  markdownContent: string;
  sourceId?: string;
  source: string;
  icon?: string;
  createdAt: string;
  readAt?: string;
}

interface NotificationRow {
  id: string;
  user_id: string;
  title: string;
  short_description: string;
  markdown_content: string;
  source_id: string | null;
  source: string;
  icon_data_url: string | null;
  created_at: string;
  read_at: string | null;
}

function mapNotification(row: NotificationRow): PersistedNotification {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    shortDescription: row.short_description,
    markdownContent: row.markdown_content,
    sourceId: row.source_id ?? undefined,
    source: row.source,
    icon: row.icon_data_url ?? undefined,
    createdAt: row.created_at,
    readAt: row.read_at ?? undefined,
  };
}

export interface ListNotificationOptions {
  owner: OwnerAccount;
  sourceId?: string;
  limit: number;
  offset: number;
  read?: boolean;
}

export function insertNotification(notification: PersistedNotification, owner: OwnerAccount): void {
  const userId = requireOwner(owner);
  if (notification.userId !== userId) throw new Error("Notification ownership does not match the owner");
  getDatabase().query(`
    INSERT INTO notifications (id, user_id, title, short_description, markdown_content, source_id, source, icon_data_url, created_at, read_at)
    VALUES ($id, $userId, $title, $shortDescription, $markdownContent, $sourceId, $source, $icon, $createdAt, $readAt)
  `).run({
    id: notification.id,
    userId,
    title: notification.title,
    shortDescription: notification.shortDescription,
    markdownContent: notification.markdownContent,
    sourceId: notification.sourceId ?? null,
    source: notification.source,
    icon: notification.icon ?? null,
    createdAt: notification.createdAt,
    readAt: notification.readAt ?? null,
  });
}

function whereClause(options: Pick<ListNotificationOptions, "owner" | "sourceId" | "read">): string {
  requireOwner(options.owner);
  const parts: string[] = ["user_id = $userId"];
  if (options.sourceId) {
    parts.push("source_id = $sourceId");
  }
  if (options.read !== undefined) {
    parts.push(options.read ? "read_at IS NOT NULL" : "read_at IS NULL");
  }
  return parts.length ? `WHERE ${parts.join(" AND ")}` : "";
}

export function listNotifications(options: ListNotificationOptions): { notifications: PersistedNotification[]; total: number } {
  const where = whereClause(options);
  const params = {
    sourceId: options.sourceId ?? null,
    userId: requireOwner(options.owner),
    limit: options.limit,
    offset: options.offset,
  };
  const rows = getDatabase().query(`
    SELECT * FROM notifications
    ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT $limit OFFSET $offset
  `).all(params) as NotificationRow[];
  const totalRow = getDatabase().query(`SELECT COUNT(*) as count FROM notifications ${where}`).get(params) as { count: number };
  return { notifications: rows.map(mapNotification), total: totalRow.count };
}

export function countUnreadNotifications(owner: OwnerAccount): number {
  const ownerId = requireOwner(owner);
  const row = getDatabase().query("SELECT COUNT(*) as count FROM notifications WHERE user_id = $userId AND read_at IS NULL").get({ userId: ownerId }) as { count: number };
  return row.count;
}

export function getNotificationById(id: string, owner: OwnerAccount): PersistedNotification | undefined {
  const ownerId = requireOwner(owner);
  const row = getDatabase().query("SELECT * FROM notifications WHERE id = $id AND user_id = $userId").get({ id, userId: ownerId }) as NotificationRow | null;
  return row ? mapNotification(row) : undefined;
}

export function markNotificationRead(id: string, readAt: string, owner: OwnerAccount): PersistedNotification | undefined {
  const ownerId = requireOwner(owner);
  getDatabase().query(`
    UPDATE notifications
    SET read_at = COALESCE(read_at, $readAt)
    WHERE id = $id AND user_id = $userId
  `).run({ id, readAt, userId: ownerId });
  return getNotificationById(id, owner);
}

export function markNotificationUnread(id: string, owner: OwnerAccount): PersistedNotification | undefined {
  const ownerId = requireOwner(owner);
  getDatabase().query(`
    UPDATE notifications
    SET read_at = NULL
    WHERE id = $id AND user_id = $userId
  `).run({ id, userId: ownerId });
  return getNotificationById(id, owner);
}

export function markNotificationsRead(options: Pick<ListNotificationOptions, "owner" | "sourceId" | "read">, readAt: string): number {
  const where = whereClause(options);
  const result = getDatabase().query(`
    UPDATE notifications
    SET read_at = COALESCE(read_at, $readAt)
    ${where}
  `).run({
    sourceId: options.sourceId ?? null,
    userId: requireOwner(options.owner),
    readAt,
  });
  return result.changes;
}

export function deleteNotificationById(id: string, owner: OwnerAccount): boolean {
  const ownerId = requireOwner(owner);
  const result = getDatabase().query("DELETE FROM notifications WHERE id = $id AND user_id = $userId").run({ id, userId: ownerId });
  return result.changes > 0;
}

export function deleteNotifications(options: Pick<ListNotificationOptions, "owner" | "sourceId" | "read">): number {
  const where = whereClause(options);
  const result = getDatabase().query(`DELETE FROM notifications ${where}`).run({
    sourceId: options.sourceId ?? null,
    userId: requireOwner(options.owner),
  });
  return result.changes;
}
