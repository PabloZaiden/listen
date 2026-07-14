import type { Database } from "bun:sqlite";
import type { Migration } from "./index";

function hasWebhookSourceDisabledColumn(database: Database): boolean {
  const columns = database.query("PRAGMA table_info(webhook_sources)").all() as Array<{ name: string }>;
  return columns.some((column) => column.name === "disabled_at");
}

function hasBrowserPushDisabledColumn(database: Database): boolean {
  const columns = database.query("PRAGMA table_info(browser_push_subscriptions)").all() as Array<{ name: string }>;
  return columns.some((column) => column.name === "disabled_at");
}

export const removeDisabledStateMigration: Migration = {
  version: 2,
  name: "remove_disabled_state",
  run(database) {
    const hasSourceDisabledColumn = hasWebhookSourceDisabledColumn(database);
    const hasPushDisabledColumn = hasBrowserPushDisabledColumn(database);

    if (hasSourceDisabledColumn) {
      database.query("DELETE FROM webhook_sources WHERE disabled_at IS NOT NULL").run();
    }
    if (hasPushDisabledColumn) {
      database.query("DELETE FROM browser_push_subscriptions WHERE disabled_at IS NOT NULL").run();
    }

    database.exec(`
      DROP INDEX IF EXISTS idx_browser_push_active_next_attempt;
      DROP INDEX IF EXISTS idx_browser_push_user_active_next_attempt;
      CREATE INDEX IF NOT EXISTS idx_browser_push_user_next_attempt
      ON browser_push_subscriptions(user_id, next_attempt_at);
    `);

    if (hasSourceDisabledColumn) {
      database.exec("ALTER TABLE webhook_sources DROP COLUMN disabled_at");
    }
    if (hasPushDisabledColumn) {
      database.exec("ALTER TABLE browser_push_subscriptions DROP COLUMN disabled_at");
    }
  },
};
