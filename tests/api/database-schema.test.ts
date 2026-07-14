import "./../setup";
import { describe, expect, test } from "bun:test";
import { getDatabase } from "../../src/persistence/database";

function tableNames(): Set<string> {
  const rows = getDatabase().query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function columnInfo(table: string): Array<{ name: string; notnull: number }> {
  return getDatabase().query(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number }>;
}

function foreignKeys(table: string): Array<{ from: string; table: string; on_delete: string }> {
  return getDatabase().query(`PRAGMA foreign_key_list(${table})`).all() as Array<{ from: string; table: string; on_delete: string }>;
}

describe("database schema", () => {
  test("uses the clean framework-owned auth baseline", () => {
    const tables = tableNames();

    expect(tables.has("passkey_credentials")).toBe(false);
    expect(tables.has("auth_device_requests")).toBe(false);
    expect(tables.has("auth_refresh_sessions")).toBe(false);
  });

  test("keeps app data owned by framework users", () => {
    for (const table of ["webhook_sources", "notifications", "browser_push_subscriptions"]) {
      const userId = columnInfo(table).find((column) => column.name === "user_id");
      expect(userId?.notnull).toBe(1);
      expect(foreignKeys(table)).toContainEqual(expect.objectContaining({
        from: "user_id",
        table: "webapp_users",
        on_delete: "CASCADE",
      }));
    }
  });

  test("keeps source notification cascades enabled", () => {
    expect(foreignKeys("notifications")).toContainEqual(expect.objectContaining({
      from: "source_id",
      table: "webhook_sources",
      on_delete: "CASCADE",
    }));
    const foreignKeysEnabled = getDatabase().query("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(foreignKeysEnabled.foreign_keys).toBe(1);
  });

  test("stores webhook source credentials as hashes only", () => {
    const columns = columnInfo("webhook_sources").map((column) => column.name);

    expect(columns).toContain("token_hash");
    expect(columns).not.toContain("token");
  });
});
