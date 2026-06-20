import { getDatabase } from "./database";

export interface PersistedNotification {
  id: string;
  title: string;
  shortDescription: string;
  markdownContent: string;
  sourceId?: string;
  source: string;
  icon?: string;
  createdAt: string;
  openedAt?: string;
}

interface NotificationRow {
  id: string;
  title: string;
  short_description: string;
  markdown_content: string;
  source_id: string | null;
  source: string;
  icon_data_url: string | null;
  created_at: string;
  opened_at: string | null;
}

function mapNotification(row: NotificationRow): PersistedNotification {
  return {
    id: row.id,
    title: row.title,
    shortDescription: row.short_description,
    markdownContent: row.markdown_content,
    sourceId: row.source_id ?? undefined,
    source: row.source,
    icon: row.icon_data_url ?? undefined,
    createdAt: row.created_at,
    openedAt: row.opened_at ?? undefined,
  };
}

export interface ListNotificationOptions {
  sourceId?: string;
  limit: number;
  offset: number;
  opened?: boolean;
}

export function insertNotification(notification: PersistedNotification): void {
  getDatabase().query(`
    INSERT INTO notifications (id, title, short_description, markdown_content, source_id, source, icon_data_url, created_at, opened_at)
    VALUES ($id, $title, $shortDescription, $markdownContent, $sourceId, $source, $icon, $createdAt, $openedAt)
  `).run({
    id: notification.id,
    title: notification.title,
    shortDescription: notification.shortDescription,
    markdownContent: notification.markdownContent,
    sourceId: notification.sourceId ?? null,
    source: notification.source,
    icon: notification.icon ?? null,
    createdAt: notification.createdAt,
    openedAt: notification.openedAt ?? null,
  });
}

function whereClause(options: Pick<ListNotificationOptions, "sourceId" | "opened">): string {
  const parts: string[] = [];
  if (options.sourceId) {
    parts.push("source_id = $sourceId");
  }
  if (options.opened !== undefined) {
    parts.push(options.opened ? "opened_at IS NOT NULL" : "opened_at IS NULL");
  }
  return parts.length ? `WHERE ${parts.join(" AND ")}` : "";
}

export function listNotifications(options: ListNotificationOptions): { notifications: PersistedNotification[]; total: number } {
  const where = whereClause(options);
  const params = {
    sourceId: options.sourceId ?? null,
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

export function countUnreadNotifications(): number {
  const row = getDatabase().query("SELECT COUNT(*) as count FROM notifications WHERE opened_at IS NULL").get() as { count: number };
  return row.count;
}

export function getNotificationById(id: string): PersistedNotification | undefined {
  const row = getDatabase().query("SELECT * FROM notifications WHERE id = $id").get({ id }) as NotificationRow | null;
  return row ? mapNotification(row) : undefined;
}

export function markNotificationOpened(id: string, openedAt: string): PersistedNotification | undefined {
  getDatabase().query(`
    UPDATE notifications
    SET opened_at = COALESCE(opened_at, $openedAt)
    WHERE id = $id
  `).run({ id, openedAt });
  return getNotificationById(id);
}

export function markNotificationRead(id: string, openedAt: string): PersistedNotification | undefined {
  getDatabase().query(`
    UPDATE notifications
    SET opened_at = COALESCE(opened_at, $openedAt)
    WHERE id = $id
  `).run({ id, openedAt });
  return getNotificationById(id);
}

export function markNotificationUnread(id: string): PersistedNotification | undefined {
  getDatabase().query(`
    UPDATE notifications
    SET opened_at = NULL
    WHERE id = $id
  `).run({ id });
  return getNotificationById(id);
}

export function markNotificationsRead(options: Pick<ListNotificationOptions, "sourceId" | "opened">, openedAt: string): number {
  const where = whereClause(options);
  const result = getDatabase().query(`
    UPDATE notifications
    SET opened_at = COALESCE(opened_at, $openedAt)
    ${where}
  `).run({
    sourceId: options.sourceId ?? null,
    openedAt,
  });
  return result.changes;
}

export function deleteNotificationById(id: string): boolean {
  const result = getDatabase().query("DELETE FROM notifications WHERE id = $id").run({ id });
  return result.changes > 0;
}

export function deleteNotifications(options: Pick<ListNotificationOptions, "sourceId" | "opened"> = {}): number {
  const where = whereClause(options);
  const result = getDatabase().query(`DELETE FROM notifications ${where}`).run({
    sourceId: options.sourceId ?? null,
  });
  return result.changes;
}
