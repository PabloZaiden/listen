import { getDatabase } from "./database";
import { requireUserId } from "@listen/shared";

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
  user_id: string;
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
    userId: row.user_id,
    name: row.name,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at ?? undefined,
    disabledAt: row.disabled_at ?? undefined,
  };
}

export function insertSource(source: PersistedSource): void {
  const userId = requireUserId(source.userId);
  getDatabase().query(`
    INSERT INTO webhook_sources (id, user_id, name, token_hash, created_at, updated_at, last_used_at, disabled_at)
    VALUES ($id, $userId, $name, $tokenHash, $createdAt, $updatedAt, $lastUsedAt, $disabledAt)
  `).run({
    id: source.id,
    userId,
    name: source.name,
    tokenHash: source.tokenHash,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    lastUsedAt: source.lastUsedAt ?? null,
    disabledAt: source.disabledAt ?? null,
  });
}

export function listSources(includeDisabled: boolean, userId: string): PersistedSource[] {
  const database = getDatabase();
  const ownerId = requireUserId(userId);
  const sql = includeDisabled
    ? "SELECT * FROM webhook_sources WHERE user_id = $userId ORDER BY created_at DESC, id DESC"
    : "SELECT * FROM webhook_sources WHERE user_id = $userId AND disabled_at IS NULL ORDER BY created_at DESC, id DESC";
  return (database.query(sql).all({ userId: ownerId }) as SourceRow[]).map(mapSource);
}

export function getSourceById(id: string, userId: string): PersistedSource | undefined {
  const ownerId = requireUserId(userId);
  const row = getDatabase().query("SELECT * FROM webhook_sources WHERE id = $id AND user_id = $userId").get({ id, userId: ownerId }) as SourceRow | null;
  return row ? mapSource(row) : undefined;
}

export function getSourceByIdForWebhook(id: string): PersistedSource | undefined {
  const row = getDatabase().query("SELECT * FROM webhook_sources WHERE id = $id").get({ id }) as SourceRow | null;
  return row ? mapSource(row) : undefined;
}

export function updateSourceTokenHash(id: string, tokenHash: string, updatedAt: string, userId: string): PersistedSource | undefined {
  const ownerId = requireUserId(userId);
  getDatabase().query(`
    UPDATE webhook_sources
    SET token_hash = $tokenHash, updated_at = $updatedAt
    WHERE id = $id AND user_id = $userId
  `).run({ id, tokenHash, updatedAt, userId: ownerId });
  return getSourceById(id, ownerId);
}

export function updateSourceLastUsedAt(id: string, lastUsedAt: string, userId: string): PersistedSource | undefined {
  const ownerId = requireUserId(userId);
  getDatabase().query(`
    UPDATE webhook_sources
    SET last_used_at = $lastUsedAt, updated_at = $lastUsedAt
    WHERE id = $id AND user_id = $userId
  `).run({ id, lastUsedAt, userId: ownerId });
  return getSourceById(id, ownerId);
}

export function deleteSource(id: string, userId: string): { source: PersistedSource; deletedNotificationCount: number } | undefined {
  const database = getDatabase();
  const ownerId = requireUserId(userId);
  const deletion = database.transaction(() => {
    const source = getSourceById(id, ownerId);
    if (!source) {
      return undefined;
    }

    const notificationCount = database.query(
      "SELECT COUNT(*) as count FROM notifications WHERE source_id = $id",
    ).get({ id }) as { count: number };
    const deletedSource = database.query(
      "DELETE FROM webhook_sources WHERE id = $id AND user_id = $userId",
    ).run({ id, userId: ownerId });
    if (deletedSource.changes === 0) {
      return undefined;
    }
    return { source, deletedNotificationCount: notificationCount.count };
  });
  return deletion.immediate();
}
