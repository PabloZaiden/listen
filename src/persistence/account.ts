import { getDatabase } from "./database";

export interface OwnerAccount {
  id: string;
  username: string;
  authVersion: number;
}

interface OwnerRow {
  id: string;
  username: string;
  auth_version: number;
}

export function getOwner(): OwnerAccount | undefined {
  const row = getDatabase().query("SELECT id, username, auth_version FROM listen_owner WHERE singleton = 1").get() as OwnerRow | null;
  return row ? { id: row.id, username: row.username, authVersion: row.auth_version } : undefined;
}

export function requireOwner(owner: OwnerAccount): string {
  const current = getOwner();
  if (!current || current.id !== owner.id || current.authVersion !== owner.authVersion) {
    throw new Error("A current Listen owner is required");
  }
  return current.id;
}

export function createOwner(id: string, username: string): OwnerAccount {
  const now = new Date().toISOString();
  getDatabase().query("INSERT INTO listen_owner VALUES (1, ?, ?, 1, ?, ?)").run(id, username, now, now);
  return { id, username, authVersion: 1 };
}

export function getAccountPreference(key: string): string | undefined {
  const row = getDatabase().query("SELECT value FROM listen_account_preferences WHERE key = ?").get(key) as { value: string } | null;
  return row?.value;
}

export function setAccountPreference(key: string, value: string): void {
  getDatabase().query("INSERT INTO listen_account_preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
