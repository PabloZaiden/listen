import { Database } from "bun:sqlite";
import { createHash, createHmac } from "node:crypto";
import { join } from "node:path";
import webPush from "web-push";
import { fixturePasskey } from "./passkey";

// Supported multi-user schema snapshot. SQL is fixture setup, never an assertion surface.
const legacySchema = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE webapp_users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, role TEXT NOT NULL, auth_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT, disabled_at TEXT);
  CREATE TABLE webapp_preferences (key TEXT NOT NULL, user_id TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(key,user_id));
  CREATE TABLE webapp_passkeys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES webapp_users(id) ON DELETE CASCADE, name TEXT NOT NULL, credential_id TEXT NOT NULL UNIQUE, public_key BLOB NOT NULL, counter INTEGER NOT NULL, device_type TEXT NOT NULL, backed_up INTEGER NOT NULL, transports TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_used_at TEXT);
  CREATE TABLE webapp_api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES webapp_users(id) ON DELETE CASCADE, name TEXT NOT NULL, prefix TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT, expires_at TEXT, kind TEXT NOT NULL DEFAULT 'user', managed_by TEXT);
  CREATE TABLE webapp_user_setup_links (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES webapp_users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, created_by_user_id TEXT REFERENCES webapp_users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT);
  CREATE TABLE webapp_device_auth_requests (device_code_hash TEXT PRIMARY KEY, user_code TEXT NOT NULL UNIQUE, client_id TEXT NOT NULL, scope TEXT NOT NULL, status TEXT NOT NULL, approved_by_user_id TEXT REFERENCES webapp_users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL);
  CREATE TABLE webapp_refresh_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES webapp_users(id) ON DELETE CASCADE, family_id TEXT NOT NULL, client_id TEXT NOT NULL, scope TEXT NOT NULL, refresh_token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT);
  CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE webhook_sources (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES webapp_users(id) ON DELETE CASCADE, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_used_at TEXT);
  CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES webapp_users(id) ON DELETE CASCADE, title TEXT NOT NULL, short_description TEXT NOT NULL, markdown_content TEXT NOT NULL, source_id TEXT REFERENCES webhook_sources(id) ON DELETE CASCADE, source TEXT NOT NULL, icon_data_url TEXT, created_at TEXT NOT NULL, read_at TEXT);
  CREATE TABLE browser_push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES webapp_users(id) ON DELETE CASCADE, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, expiration_time INTEGER, user_agent TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_success_at TEXT, last_failure_at TEXT, failure_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT);
`;

export async function legacyDataset(directory: string, ownerState: "valid" | "missing" | "ambiguous" = "valid") {
  const db = new Database(join(directory, "listen.db"));
  db.exec(legacySchema);
  const ownerPasskey = fixturePasskey();
  const otherPasskey = fixturePasskey();
  const vapid = webPush.generateVAPIDKeys();
  const timestamp = "2026-10-01T10:00:00.000Z";
  const readAt = "2026-10-01T11:00:00.000Z";
  const sessionSecret = "legacy-fixture-secret-only-do-not-use-outside-tests";
  const oldApiToken = "legacy-fixture-api-token";
  const oldSetupToken = "legacy-fixture-setup-token";
  const sources = Array.from({ length: 3 }, (_, index) => ({
    id: `source-${index}`, token: `legacy-webhook-token-${index}`, name: `Source ${index}`,
  }));
  db.transaction(() => {
    for (const [index, id] of ["owner", "member", "administrator"].entries()) {
      const role = index === 0 && ownerState !== "missing" ? "owner" : index === 2 ? ownerState === "ambiguous" ? "owner" : "admin" : "user";
      db.query("INSERT INTO webapp_users VALUES (?, ?, ?, 1, ?, ?, NULL, NULL)").run(id, id, role, timestamp, timestamp);
      const source = sources[index]!;
      db.query("INSERT INTO webhook_sources VALUES (?, ?, ?, ?, ?, ?, NULL)")
        .run(source.id, id, source.name, createHash("sha256").update(source.token).digest("hex"), timestamp, timestamp);
      db.query("INSERT INTO notifications VALUES (?, ?, ?, 'Summary', ?, ?, ?, NULL, ?, ?)")
        .run(`notification-${index}`, id, `Notification ${index}`, `# Body ${index}`, source.id, source.name, timestamp, index === 1 ? null : readAt);
    }
    for (const [id, key] of [["owner", ownerPasskey], ["member", otherPasskey]] as const) {
      db.query("INSERT INTO webapp_passkeys VALUES (?, ?, 'Primary passkey', ?, ?, 0, 'singleDevice', 0, '[\"internal\"]', ?, ?, NULL)")
        .run(`passkey-${id}`, id, key.id, key.publicKey, timestamp, timestamp);
      db.query("INSERT INTO browser_push_subscriptions VALUES (?, ?, ?, 'fixture-p256dh', 'fixture-auth', 1, 'fixture', ?, ?, NULL, NULL, 0, NULL)")
        .run(`push-${id}`, id, `https://push.invalid/${id}`, timestamp, timestamp);
    }
    db.query("INSERT INTO webapp_preferences VALUES ('passkey.secret', '', ?, ?)").run(sessionSecret, timestamp);
    db.query("INSERT INTO webapp_preferences VALUES ('theme', 'owner', 'light', ?)").run(timestamp);
    db.query("INSERT INTO webapp_preferences VALUES ('theme', 'member', 'dark', ?)").run(timestamp);
    db.query("INSERT INTO preferences VALUES ('browserPush.vapidPublicKey', ?)").run(vapid.publicKey);
    db.query("INSERT INTO preferences VALUES ('browserPush.vapidPrivateKey', ?)").run(vapid.privateKey);
    db.query("INSERT INTO webapp_api_keys VALUES ('key-member', 'member', 'Fixture', 'fixture', ?, '[\"*\"]', ?, NULL, NULL, 'user', NULL)")
      .run(createHash("sha256").update(oldApiToken).digest("base64url"), timestamp);
    db.query("INSERT INTO webapp_user_setup_links VALUES ('setup-member', 'member', ?, 'setup', 'owner', ?, '2099-01-01T00:00:00.000Z', NULL)")
      .run(createHash("sha256").update(oldSetupToken).digest("base64url"), timestamp);
    db.query("INSERT INTO webapp_device_auth_requests VALUES ('fixture-device-hash', 'FIXTURE', 'fixture-client', '*', 'approved', 'owner', ?, ?, '2099-01-01T00:00:00.000Z')")
      .run(timestamp, timestamp);
    db.query("INSERT INTO webapp_refresh_sessions VALUES ('fixture-refresh', 'owner', 'family', 'fixture-client', '*', 'fixture-refresh-hash', ?, ?, '2099-01-01T00:00:00.000Z', NULL, NULL)")
      .run(timestamp, timestamp);
  }).immediate();
  const payload = Buffer.from(JSON.stringify({ nonce: "fixture", userId: "owner", authVersion: 1, passkeyId: "passkey-owner", expiresAt: Date.now() + 60_000 })).toString("base64url");
  return {
    ownerPasskey, otherPasskey, vapidPublicKey: vapid.publicKey, sources, readAt, oldApiToken, oldSetupToken,
    oldCookie: `webapp_passkey_session=${payload}.${createHmac("sha256", sessionSecret).update(payload).digest("base64url")}`,
    close: () => db.close(),
  };
}
