import { Database } from "bun:sqlite";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { migrateSingleAccount } from "./migrations/001-single-account";

let database: Database | undefined;
let databasePath: string | undefined;

export function getDatabasePath(dataDir = process.env["LISTEN_DATA_DIR"] ?? "./data"): string {
  return join(dataDir, "listen.db");
}

export function initializeDatabase(dataDir = process.env["LISTEN_DATA_DIR"] ?? "./data"): Database {
  const nextPath = getDatabasePath(dataDir);
  if (database && databasePath === nextPath) return database;
  closeDatabaseForTests();
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  if (!existsSync(nextPath)) closeSync(openSync(nextPath, "wx", 0o600));
  chmodSync(nextPath, 0o600);
  const nextDatabase = new Database(nextPath, { create: true, strict: true });
  try {
    nextDatabase.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    migrateSingleAccount(nextDatabase, dataDir);
  } catch (error) {
    nextDatabase.close();
    throw error;
  }
  database = nextDatabase;
  databasePath = nextPath;
  return nextDatabase;
}

export function getDatabase(): Database {
  return database ?? initializeDatabase();
}

export function closeDatabaseForTests(): void {
  database?.close();
  database = undefined;
  databasePath = undefined;
}
