import "./../setup";
import { describe, expect, test } from "bun:test";
import { getDatabase } from "../../src/persistence/database";

function columnInfo(table: string): Array<{ name: string; notnull: number }> {
  return getDatabase().query(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number }>;
}

function foreignKeys(table: string): Array<{ from: string; table: string; on_delete: string }> {
  return getDatabase().query(`PRAGMA foreign_key_list(${table})`).all() as Array<{ from: string; table: string; on_delete: string }>;
}

describe("persistence security invariants", () => {
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

  test("stores webhook source credentials as hashes only", () => {
    const columns = columnInfo("webhook_sources").map((column) => column.name);

    expect(columns).toContain("token_hash");
    expect(columns).not.toContain("token");
  });
});
