import { getDatabase } from "./database";
import { createLogger } from "../core/logger";

const log = createLogger("preferences");

export function getPreference(key: string): string | undefined {
  const row = getDatabase().query("SELECT value FROM preferences WHERE key = $key").get({ key }) as { value: string } | null;
  return row?.value;
}

export function setPreference(key: string, value: string): void {
  getDatabase().query(`
    INSERT INTO preferences (key, value)
    VALUES ($key, $value)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run({ key, value });
}

export function deletePreference(key: string): void {
  getDatabase().query("DELETE FROM preferences WHERE key = $key").run({ key });
}

export function parsePersistedJson<T>(key: string, value: string | undefined, fallback: T): T {
  if (value === undefined) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    log.warn("Failed to parse persisted JSON preference", { key, error });
    return fallback;
  }
}
