import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runMigrations } from "../../src/persistence/migrations";

describe("database migrations", () => {
  test("hard delete sources migration cascades notifications and removes disabled sources", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "listen-migration-"));
    const db = new Database(join(dataDir, "listen.db"), { create: true, strict: true });

    try {
      db.exec("PRAGMA foreign_keys = ON");
      db.exec(`
        CREATE TABLE webhook_sources (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_used_at TEXT,
          disabled_at TEXT
        );

        CREATE TABLE notifications (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          short_description TEXT NOT NULL,
          markdown_content TEXT NOT NULL,
          source_id TEXT,
          source TEXT NOT NULL,
          icon_data_url TEXT,
          created_at TEXT NOT NULL,
          opened_at TEXT,
          FOREIGN KEY (source_id) REFERENCES webhook_sources(id) ON DELETE SET NULL
        );
      `);
      db.query(`
        INSERT INTO webhook_sources (id, name, token_hash, created_at, updated_at, disabled_at)
        VALUES ($id, $name, $tokenHash, $createdAt, $updatedAt, $disabledAt)
      `).run({ id: "source-a", name: "A", tokenHash: "hash-a", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", disabledAt: null });
      db.query(`
        INSERT INTO webhook_sources (id, name, token_hash, created_at, updated_at, disabled_at)
        VALUES ($id, $name, $tokenHash, $createdAt, $updatedAt, $disabledAt)
      `).run({ id: "source-b", name: "B", tokenHash: "hash-b", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", disabledAt: "2026-01-01T00:00:01.000Z" });
      db.query(`
        INSERT INTO notifications (id, title, short_description, markdown_content, source_id, source, created_at)
        VALUES ($id, $title, $shortDescription, $markdownContent, $sourceId, $source, $createdAt)
      `).run({ id: "notification-a", title: "A", shortDescription: "A", markdownContent: "A", sourceId: "source-a", source: "A", createdAt: "2026-01-01T00:00:00.000Z" });
      db.query(`
        INSERT INTO notifications (id, title, short_description, markdown_content, source_id, source, created_at)
        VALUES ($id, $title, $shortDescription, $markdownContent, $sourceId, $source, $createdAt)
      `).run({ id: "notification-b", title: "B", shortDescription: "B", markdownContent: "B", sourceId: "source-b", source: "B", createdAt: "2026-01-01T00:00:00.000Z" });

      runMigrations(db);

      const migration = db.query("SELECT name FROM schema_migrations WHERE version = 1").get() as { name: string } | null;
      const disabledSource = db.query("SELECT id FROM webhook_sources WHERE id = 'source-b'").get();
      const disabledNotification = db.query("SELECT id FROM notifications WHERE id = 'notification-b'").get();
      const foreignKey = db.query("PRAGMA foreign_key_list(notifications)").get() as { on_delete: string } | null;

      expect(migration?.name).toBe("hard_delete_sources");
      expect(disabledSource).toBeNull();
      expect(disabledNotification).toBeNull();
      expect(foreignKey?.on_delete).toBe("CASCADE");

      db.query("DELETE FROM webhook_sources WHERE id = 'source-a'").run();
      const activeNotification = db.query("SELECT id FROM notifications WHERE id = 'notification-a'").get();
      expect(activeNotification).toBeNull();
    } finally {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});