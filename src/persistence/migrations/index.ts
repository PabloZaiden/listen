import type { Database } from "bun:sqlite";

interface Migration {
  version: number;
  name: string;
  run: (db: Database) => void;
}

function hasMigration(db: Database, version: number): boolean {
  const row = db.query("SELECT version FROM schema_migrations WHERE version = $version").get({ version }) as { version: number } | null;
  return Boolean(row);
}

function recordMigration(db: Database, migration: Pick<Migration, "version" | "name">): void {
  db.query(`
    INSERT INTO schema_migrations (version, name, applied_at)
    VALUES ($version, $name, $appliedAt)
  `).run({ version: migration.version, name: migration.name, appliedAt: new Date().toISOString() });
}

function recreateNotificationIndexes(db: Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_notifications_created_at
    ON notifications(created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_notifications_source_created_at
    ON notifications(source_id, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_notifications_opened_at
    ON notifications(opened_at);
  `);
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "hard_delete_sources",
    run(db) {
      db.exec("PRAGMA foreign_keys = OFF");
      try {
        db.exec("BEGIN");
        db.exec(`
          DELETE FROM notifications
          WHERE source_id IN (SELECT id FROM webhook_sources WHERE disabled_at IS NOT NULL);

          DELETE FROM webhook_sources
          WHERE disabled_at IS NOT NULL;

          CREATE TABLE notifications_new (
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

          INSERT INTO notifications_new (
            id, title, short_description, markdown_content, source_id, source, icon_data_url, created_at, opened_at
          )
          SELECT id, title, short_description, markdown_content, source_id, source, icon_data_url, created_at, opened_at
          FROM notifications;

          DROP TABLE notifications;
          ALTER TABLE notifications_new RENAME TO notifications;
        `);
        recreateNotificationIndexes(db);
        recordMigration(db, { version: 1, name: "hard_delete_sources" });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        db.exec("PRAGMA foreign_keys = ON");
      }
    },
  },
];

export function runMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  for (const migration of migrations) {
    if (!hasMigration(db, migration.version)) {
      migration.run(db);
    }
  }
}
