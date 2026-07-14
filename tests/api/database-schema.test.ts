import "./../setup";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  test("rejects a legacy notifications table without read_at", async () => {
    const legacyDataDir = mkdtempSync(join(tmpdir(), "listen-legacy-data-"));
    try {
      const legacyDatabase = new Database(join(legacyDataDir, "listen.db"), { create: true, strict: true });
      legacyDatabase.exec(`
        CREATE TABLE notifications (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL
        );
      `);
      legacyDatabase.close();

      const child = Bun.spawn({
        cmd: [
          "bun",
          "--eval",
          `
            import { initializeDatabase } from "./src/persistence/database.ts";
            const dataDir = process.env["LISTEN_DATA_DIR"];
            if (!dataDir) throw new Error("LISTEN_DATA_DIR is required");
            try {
              initializeDatabase(dataDir);
            } catch (error) {
              console.error(error instanceof Error ? error.message : String(error));
              process.exit(1);
            }
          `,
        ],
        env: { ...process.env, LISTEN_DATA_DIR: legacyDataDir },
        stderr: "pipe",
        stdout: "ignore",
      });
      const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/notifications table.*read_at.*fresh data directory.*out of band/i);
    } finally {
      rmSync(legacyDataDir, { recursive: true, force: true });
    }
  });
});
