import { getDatabase } from "./database";

export interface PersistedSource {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  disabledAt?: string;
}

interface SourceRow {
  id: string;
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
    INSERT INTO webhook_sources (id, name, token_hash, created_at, updated_at, last_used_at, disabled_at)
    VALUES ($id, $name, $tokenHash, $createdAt, $updatedAt, $lastUsedAt, $disabledAt)
  `).run({
    id: source.id,
    name: source.name,
    tokenHash: source.tokenHash,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    lastUsedAt: source.lastUsedAt ?? null,
    disabledAt: source.disabledAt ?? null,
  });
}

export function listSources(includeDisabled: boolean): PersistedSource[] {
  const sql = includeDisabled
    ? "SELECT * FROM webhook_sources ORDER BY created_at DESC, id DESC"
    : "SELECT * FROM webhook_sources WHERE disabled_at IS NULL ORDER BY created_at DESC, id DESC";
  return (getDatabase().query(sql).all() as SourceRow[]).map(mapSource);
}

export function getSourceById(id: string): PersistedSource | undefined {
  const row = getDatabase().query("SELECT * FROM webhook_sources WHERE id = $id").get({ id }) as SourceRow | null;
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

export function disableSource(id: string, disabledAt: string): PersistedSource | undefined {
  getDatabase().query(`
    UPDATE webhook_sources
    SET disabled_at = COALESCE(disabled_at, $disabledAt), updated_at = $disabledAt
    WHERE id = $id
  `).run({ id, disabledAt });
  return getSourceById(id);
}
