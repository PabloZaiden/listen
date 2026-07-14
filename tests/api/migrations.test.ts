import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { runMigrations } from "../../src/persistence/migrations";

function createLegacyDatabase(): Database {
  const database = new Database(":memory:", { strict: true });
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE webapp_users (
      id TEXT PRIMARY KEY
    );

    CREATE TABLE webhook_sources (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      disabled_at TEXT,
      FOREIGN KEY (user_id) REFERENCES webapp_users(id) ON DELETE CASCADE
    );

    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      FOREIGN KEY (source_id) REFERENCES webhook_sources(id) ON DELETE CASCADE
    );

    CREATE TABLE browser_push_subscriptions (
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
      disabled_at TEXT,
      FOREIGN KEY (user_id) REFERENCES webapp_users(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_browser_push_active_next_attempt
    ON browser_push_subscriptions(disabled_at, next_attempt_at);

    CREATE INDEX idx_browser_push_user_active_next_attempt
    ON browser_push_subscriptions(user_id, disabled_at, next_attempt_at);

    INSERT INTO webapp_users (id) VALUES ('user-1');
    INSERT INTO webhook_sources (
      id, user_id, name, token_hash, created_at, updated_at, last_used_at, disabled_at
    ) VALUES
      ('source-active', 'user-1', 'Active', 'hash-active', '2026-07-14', '2026-07-14', NULL, NULL),
      ('source-disabled', 'user-1', 'Disabled', 'hash-disabled', '2026-07-14', '2026-07-14', NULL, '2026-07-14');
    INSERT INTO notifications (id, source_id) VALUES
      ('notification-active', 'source-active'),
      ('notification-disabled', 'source-disabled');
    INSERT INTO browser_push_subscriptions (
      id, user_id, endpoint, p256dh, auth, created_at, updated_at, disabled_at
    ) VALUES
      ('push-active', 'user-1', 'https://push.example/active', 'p256dh', 'auth', '2026-07-14', '2026-07-14', NULL),
      ('push-disabled', 'user-1', 'https://push.example/disabled', 'p256dh', 'auth', '2026-07-14', '2026-07-14', '2026-07-14');
  `);
  return database;
}

function columnNames(database: Database, table: string): string[] {
  return (database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name);
}

describe("database migrations", () => {
  test("removes disabled state while preserving supported data and is idempotent", () => {
    const database = createLegacyDatabase();
    try {
      runMigrations(database);

      expect(columnNames(database, "webhook_sources")).not.toContain("disabled_at");
      expect(columnNames(database, "browser_push_subscriptions")).not.toContain("disabled_at");
      expect(database.query("SELECT id FROM webhook_sources ORDER BY id").all()).toEqual([{ id: "source-active" }]);
      expect(database.query("SELECT id FROM notifications ORDER BY id").all()).toEqual([{ id: "notification-active" }]);
      expect(database.query("SELECT id FROM browser_push_subscriptions ORDER BY id").all()).toEqual([{ id: "push-active" }]);
      expect(database.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = $name").get({
        name: "idx_browser_push_active_next_attempt",
      })).toBeNull();
      expect(database.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = $name").get({
        name: "idx_browser_push_user_active_next_attempt",
      })).toBeNull();
      expect(database.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = $name").get({
        name: "idx_browser_push_user_next_attempt",
      })).toEqual({ name: "idx_browser_push_user_next_attempt" });
      expect(database.query("SELECT version, name FROM schema_migrations").all()).toEqual([{
        version: 2,
        name: "remove_disabled_state",
      }]);

      runMigrations(database);

      expect(database.query("SELECT id FROM webhook_sources").all()).toEqual([{ id: "source-active" }]);
      expect(database.query("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });
});
