import type { Database } from "bun:sqlite";
import { closeSync, fsyncSync, mkdirSync, openSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { createAccountSchema, createDomainIndexes, createDomainSchema } from "../schema";

export const SINGLE_ACCOUNT_BACKUP = "listen.pre-single-account.db";

function tableExists(db: Database, table: string): boolean {
  return Boolean(db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function requireColumns(db: Database, table: string, required: string[]): void {
  const columns = (db.query(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((column) => column.name);
  if (required.some((column) => !columns.includes(column))) {
    throw new Error(`Unsupported Listen database schema: ${table} does not match the supported current legacy schema. Restore a supported backup or migrate out of band.`);
  }
}

function backupDatabase(db: Database, dataDir: string): void {
  const backupDir = join(dataDir, "backups");
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  chmodSync(backupDir, 0o700);
  const backupPath = join(backupDir, SINGLE_ACCOUNT_BACKUP);
  // Reserve the name privately and never overwrite an operator's recovery copy.
  const descriptor = openSync(backupPath, "wx", 0o600);
  try {
    db.query("VACUUM INTO ?").run(backupPath);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  for (const path of [backupDir, dataDir]) {
    const directory = openSync(path, "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }
}

function validateLegacy(db: Database): { id: string; username: string; auth_version: number; created_at: string; updated_at: string } | undefined {
  const required = {
    webapp_users: ["id", "username", "role", "auth_version", "created_at", "updated_at", "disabled_at"],
    webapp_passkeys: ["id", "user_id", "name", "credential_id", "public_key", "counter", "device_type", "backed_up", "transports", "created_at", "updated_at", "last_used_at"],
    webapp_preferences: ["key", "user_id", "value", "updated_at"],
    webhook_sources: ["id", "user_id", "name", "token_hash", "created_at", "updated_at", "last_used_at"],
    notifications: ["id", "user_id", "title", "short_description", "markdown_content", "source_id", "source", "icon_data_url", "created_at", "read_at"],
    browser_push_subscriptions: ["id", "user_id", "endpoint", "p256dh", "auth", "expiration_time", "user_agent", "created_at", "updated_at", "last_success_at", "last_failure_at", "failure_count", "next_attempt_at"],
    preferences: ["key", "value"],
  };
  for (const [table, columns] of Object.entries(required)) requireColumns(db, table, columns);
  const owners = db.query("SELECT * FROM webapp_users WHERE role = 'owner'").all() as Array<{ id: string; username: string; auth_version: number; created_at: string; updated_at: string; disabled_at: string | null }>;
  const populated = ["webapp_users", "webapp_passkeys", "webhook_sources", "notifications", "browser_push_subscriptions", "webapp_api_keys", "webapp_refresh_sessions", "webapp_user_setup_links", "webapp_device_auth_requests"]
    .some((table) => tableExists(db, table) && Boolean(db.query(`SELECT 1 FROM "${table}" LIMIT 1`).get()));
  if (owners.length > 1 || (populated && owners.length !== 1) || owners[0]?.disabled_at) {
    throw new Error("Cannot migrate Listen: populated legacy data requires exactly one enabled existing owner. Restore or repair the legacy database before starting.");
  }
  if ((db.query("PRAGMA foreign_key_check").all()).length > 0) {
    throw new Error("Cannot migrate Listen: the legacy database has broken data relationships.");
  }
  return owners[0];
}

export function migrateSingleAccount(db: Database, dataDir: string): void {
  if (tableExists(db, "listen_migrations")) {
    const version = db.query("SELECT MAX(version) AS version FROM listen_migrations").get() as { version: number | null };
    if (version.version !== 1) throw new Error("Unsupported Listen database migration version");
    return;
  }
  const existing = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  if (existing.length === 0) {
    db.transaction(() => {
      createAccountSchema(db);
      createDomainSchema(db);
      createDomainIndexes(db);
      db.query("INSERT INTO listen_migrations VALUES (1, ?)").run(new Date().toISOString());
    }).immediate();
    return;
  }

  const owner = validateLegacy(db);
  backupDatabase(db, dataDir);
  db.transaction(() => {
    createAccountSchema(db);
    if (owner) {
      db.query("INSERT INTO listen_owner VALUES (1, ?, ?, ?, ?, ?)").run(owner.id, owner.username, owner.auth_version + 1, owner.created_at, owner.updated_at);
      db.query(`INSERT INTO listen_passkey
        SELECT id,user_id,name,credential_id,public_key,counter,device_type,backed_up,transports,created_at,updated_at,last_used_at
        FROM webapp_passkeys WHERE user_id = ?`).run(owner.id);
      db.query("INSERT INTO listen_account_preferences (key, value) SELECT key, value FROM webapp_preferences WHERE user_id = ? AND key = 'theme'").run(owner.id);
    }
    createDomainSchema(db, "_single_account");
    if (owner) {
      db.query(`INSERT INTO webhook_sources_single_account
        SELECT id, ?, name, token_hash, created_at, updated_at, last_used_at FROM webhook_sources`).run(owner.id);
      db.query(`INSERT INTO notifications_single_account
        SELECT id, ?, title, short_description, markdown_content, source_id, source, icon_data_url, created_at, read_at FROM notifications`).run(owner.id);
      db.query(`INSERT INTO browser_push_subscriptions_single_account
        SELECT id,user_id,endpoint,p256dh,auth,expiration_time,user_agent,created_at,updated_at,last_success_at,last_failure_at,failure_count,next_attempt_at
        FROM browser_push_subscriptions WHERE user_id = ?`).run(owner.id);
    }
    db.exec(`
      DROP TABLE notifications;
      DROP TABLE browser_push_subscriptions;
      DROP TABLE webhook_sources;
      ALTER TABLE webhook_sources_single_account RENAME TO webhook_sources;
      ALTER TABLE notifications_single_account RENAME TO notifications;
      ALTER TABLE browser_push_subscriptions_single_account RENAME TO browser_push_subscriptions;
    `);
    // Drop children before the old account table; domain rows now reference Listen's owner.
    const legacyTables = [
      "webapp_oauth_sessions", "webapp_oauth_authorizations", "webapp_user_setup_links",
      "webapp_audit_events", "webapp_passkeys", "webapp_api_keys", "webapp_device_auth_requests",
      "webapp_refresh_sessions", "webapp_signing_keys", "webapp_preferences", "webapp_users",
    ];
    for (const table of legacyTables) db.exec(`DROP TABLE IF EXISTS "${table}"`);
    createDomainIndexes(db);
    if (db.query("PRAGMA foreign_key_check").all().length > 0) throw new Error("Listen migration failed referential integrity verification");
    db.query("INSERT INTO listen_migrations VALUES (1, ?)").run(new Date().toISOString());
  }).immediate();
}
