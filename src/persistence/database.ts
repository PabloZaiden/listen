import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { runMigrations } from "./migrations";

let database: Database | undefined;
let databasePath: string | undefined;

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
  database = new Database(nextPath, { create: true, strict: true });
  databasePath = nextPath;
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS passkey_credentials (
      id TEXT PRIMARY KEY,
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

    CREATE TABLE IF NOT EXISTS webhook_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      disabled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      short_description TEXT NOT NULL,
      markdown_content TEXT NOT NULL,
      source_id TEXT,
      source TEXT NOT NULL,
      icon_data_url TEXT,
      created_at TEXT NOT NULL,
      opened_at TEXT,
      FOREIGN KEY (source_id) REFERENCES webhook_sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS browser_push_subscriptions (
      id TEXT PRIMARY KEY,
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
      disabled_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_created_at
    ON notifications(created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_notifications_source_created_at
    ON notifications(source_id, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_notifications_opened_at
    ON notifications(opened_at);

    CREATE INDEX IF NOT EXISTS idx_browser_push_active_next_attempt
    ON browser_push_subscriptions(disabled_at, next_attempt_at);
  `);
  runMigrations(database);
  return database;
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
