import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

let database: Database | undefined;
let databasePath: string | undefined;

const LEGACY_NOTIFICATIONS_SCHEMA_ERROR = "Unsupported database schema: the notifications table is missing the read_at column. Use a fresh data directory or migrate the data out of band before starting Listen.";

export function getDatabasePath(dataDir = process.env["LISTEN_DATA_DIR"] ?? "./data"): string {
  return join(dataDir, "listen.db");
}

export function initializeDatabase(dataDir = process.env["LISTEN_DATA_DIR"] ?? "./data"): Database {
  mkdirSync(dataDir, { recursive: true });
  const nextPath = getDatabasePath(dataDir);
  if (database && databasePath === nextPath) {
    return database;
  }

  database?.close();
  database = undefined;
  databasePath = undefined;
  const nextDatabase = new Database(nextPath, { create: true, strict: true });
  nextDatabase.exec("PRAGMA foreign_keys = ON");
  const notificationsTable = nextDatabase.query("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'notifications'").get();
  const notificationsColumns = nextDatabase.query("PRAGMA table_info(notifications)").all() as Array<{ name: string }>;
  if (notificationsTable && !notificationsColumns.some((column) => column.name === "read_at")) {
    nextDatabase.close();
    throw new Error(LEGACY_NOTIFICATIONS_SCHEMA_ERROR);
  }
  nextDatabase.exec(`
    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_sources (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      FOREIGN KEY (user_id) REFERENCES webapp_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      short_description TEXT NOT NULL,
      markdown_content TEXT NOT NULL,
      source_id TEXT,
      source TEXT NOT NULL,
      icon_data_url TEXT,
      created_at TEXT NOT NULL,
      read_at TEXT,
      FOREIGN KEY (user_id) REFERENCES webapp_users(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES webhook_sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS browser_push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
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
      next_attempt_at TEXT,
      FOREIGN KEY (user_id) REFERENCES webapp_users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_created_at
    ON notifications(created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at
    ON notifications(user_id, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_notifications_source_created_at
    ON notifications(source_id, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_notifications_read_at
    ON notifications(read_at);

    CREATE INDEX IF NOT EXISTS idx_browser_push_user_next_attempt
    ON browser_push_subscriptions(user_id, next_attempt_at);
  `);
  database = nextDatabase;
  databasePath = nextPath;
  return nextDatabase;
}

export function getDatabase(): Database {
  if (!database) {
    return initializeDatabase();
  }
  return database;
}

export function closeDatabaseForTests(): void {
  database?.close();
  database = undefined;
  databasePath = undefined;
}
