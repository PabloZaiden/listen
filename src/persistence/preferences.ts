import { getDatabase } from "./database";
import { createLogger } from "../core/logger";
import { DEFAULT_LOG_LEVEL, VALID_LOG_LEVELS, type LogLevelName } from "@listen/shared";

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

export function getLogLevelPreference(): LogLevelName {
  const value = getPreference("logLevel");
  if (value === undefined) {
    return DEFAULT_LOG_LEVEL;
  }
  if (VALID_LOG_LEVELS.includes(value as LogLevelName)) {
    return value as LogLevelName;
  }
  log.warn("Invalid log level preference, using default", { storedValue: value, default: DEFAULT_LOG_LEVEL });
  return DEFAULT_LOG_LEVEL;
}

export function setLogLevelPreference(level: LogLevelName): void {
  if (!VALID_LOG_LEVELS.includes(level)) {
    throw new Error(`Invalid log level: ${level}. Valid levels are: ${VALID_LOG_LEVELS.join(", ")}`);
  }
  setPreference("logLevel", level);
}
