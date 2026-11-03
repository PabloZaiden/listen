import type { Database } from "bun:sqlite";

export function createAccountSchema(db: Database): void {
  db.exec(`
    CREATE TABLE listen_owner (
      singleton INTEGER NOT NULL UNIQUE CHECK (singleton = 1),
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      auth_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE listen_passkey (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES listen_owner(id),
      name TEXT NOT NULL,
      credential_id TEXT NOT NULL UNIQUE,
      public_key BLOB NOT NULL,
      counter INTEGER NOT NULL,
      device_type TEXT NOT NULL,
      backed_up INTEGER NOT NULL,
      transports TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT
    );
    CREATE TABLE listen_account_preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE listen_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES listen_owner(id),
      auth_version INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE listen_passkey_challenges (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE listen_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function createDomainSchema(db: Database, suffix = ""): void {
  db.exec(`
    CREATE TABLE webhook_sources${suffix} (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES listen_owner(id),
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT
    );
    CREATE TABLE notifications${suffix} (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES listen_owner(id),
      title TEXT NOT NULL,
      short_description TEXT NOT NULL,
      markdown_content TEXT NOT NULL,
      source_id TEXT REFERENCES webhook_sources${suffix}(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      icon_data_url TEXT,
      created_at TEXT NOT NULL,
      read_at TEXT
    );
    CREATE TABLE browser_push_subscriptions${suffix} (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES listen_owner(id),
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      expiration_time INTEGER,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_success_at TEXT,
      last_failure_at TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT
    );
  `);
}

export function createDomainIndexes(db: Database): void {
  db.exec(`
    CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC, id DESC);
    CREATE INDEX idx_notifications_source_created_at ON notifications(source_id, created_at DESC, id DESC);
    CREATE INDEX idx_notifications_read_at ON notifications(read_at);
    CREATE INDEX idx_browser_push_next_attempt ON browser_push_subscriptions(next_attempt_at);
  `);
}
