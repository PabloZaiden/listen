import { getDatabase } from "./database";

export interface PersistedSource {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  disabledAt?: string;
}

interface SourceRow {
  id: string;
  user_id: string | null;
  name: string;
  token_hash: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  disabled_at: string | null;
}

function mapSource(row: SourceRow): PersistedSource {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    name: row.name,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at ?? undefined,
    disabledAt: row.disabled_at ?? undefined,
  };
}

export function insertSource(source: PersistedSource): void {
  getDatabase().query(`
    INSERT INTO webhook_sources (id, user_id, name, token_hash, created_at, updated_at, last_used_at, disabled_at)
    VALUES ($id, $userId, $name, $tokenHash, $createdAt, $updatedAt, $lastUsedAt, $disabledAt)
  `).run({
    id: source.id,
    userId: source.userId,
    name: source.name,
    tokenHash: source.tokenHash,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    lastUsedAt: source.lastUsedAt ?? null,
    disabledAt: source.disabledAt ?? null,
  });
}

export function listSources(includeDisabled: boolean, userId?: string): PersistedSource[] {
  const database = getDatabase();
  if (userId) {
    const sql = includeDisabled
      ? "SELECT * FROM webhook_sources WHERE user_id = $userId ORDER BY created_at DESC, id DESC"
      : "SELECT * FROM webhook_sources WHERE user_id = $userId AND disabled_at IS NULL ORDER BY created_at DESC, id DESC";
    return (database.query(sql).all({ userId }) as SourceRow[]).map(mapSource);
  }
  const sql = includeDisabled
    ? "SELECT * FROM webhook_sources ORDER BY created_at DESC, id DESC"
    : "SELECT * FROM webhook_sources WHERE disabled_at IS NULL ORDER BY created_at DESC, id DESC";
  return (database.query(sql).all() as SourceRow[]).map(mapSource);
}

export function getSourceById(id: string, userId?: string): PersistedSource | undefined {
  const database = getDatabase();
  const row = userId
    ? database.query("SELECT * FROM webhook_sources WHERE id = $id AND user_id = $userId").get({ id, userId }) as SourceRow | null
    : database.query("SELECT * FROM webhook_sources WHERE id = $id").get({ id }) as SourceRow | null;
  return row ? mapSource(row) : undefined;
}

export function updateSourceTokenHash(id: string, tokenHash: string, updatedAt: string): PersistedSource | undefined {
  getDatabase().query(`
    UPDATE webhook_sources
    SET token_hash = $tokenHash, updated_at = $updatedAt
    WHERE id = $id
  `).run({ id, tokenHash, updatedAt });
  return getSourceById(id);
}

export function updateSourceLastUsedAt(id: string, lastUsedAt: string): PersistedSource | undefined {
  getDatabase().query(`
    UPDATE webhook_sources
    SET last_used_at = $lastUsedAt, updated_at = $lastUsedAt
    WHERE id = $id
  `).run({ id, lastUsedAt });
  return getSourceById(id);
}

export function deleteSource(id: string, userId?: string): { source: PersistedSource; deletedNotificationCount: number } | undefined {
  const database = getDatabase();
  const source = getSourceById(id, userId);
  if (!source) {
    return undefined;
  }
  const deletedNotifications = database.query("DELETE FROM notifications WHERE source_id = $id AND ($userId IS NULL OR user_id = $userId)").run({ id, userId: userId ?? null });
  const deletedSource = database.query("DELETE FROM webhook_sources WHERE id = $id AND ($userId IS NULL OR user_id = $userId)").run({ id, userId: userId ?? null });
  if (deletedSource.changes === 0) {
    return undefined;
  }
  return { source, deletedNotificationCount: deletedNotifications.changes };
}
