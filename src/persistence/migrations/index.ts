import type { Database } from "bun:sqlite";
import { removeDisabledStateMigration } from "./remove-disabled-state";

export interface Migration {
  version: number;
  name: string;
  run: (database: Database) => void;
}

const migrations: Migration[] = [removeDisabledStateMigration];

function ensureMigrationTable(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

function hasMigration(database: Database, version: number): boolean {
  const row = database.query(
    "SELECT version FROM schema_migrations WHERE version = $version",
  ).get({ version }) as { version: number } | null;
  return Boolean(row);
}

function recordMigration(database: Database, migration: Pick<Migration, "version" | "name">): void {
  database.query(`
    INSERT INTO schema_migrations (version, name, applied_at)
    VALUES ($version, $name, $appliedAt)
  `).run({
    version: migration.version,
    name: migration.name,
    appliedAt: new Date().toISOString(),
  });
}

export function runMigrations(database: Database): void {
  ensureMigrationTable(database);

  for (const migration of migrations) {
    if (hasMigration(database, migration.version)) {
      continue;
    }

    const applyMigration = database.transaction(() => {
      migration.run(database);
      recordMigration(database, migration);
    });
    applyMigration.immediate();
  }
}
