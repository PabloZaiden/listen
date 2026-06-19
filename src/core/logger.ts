import { Logger } from "tslog";
import {
  DEFAULT_LOG_LEVEL,
  LOG_LEVEL_NAMES,
  LOG_LEVELS,
  isLogLevelName,
  type LogLevelName,
} from "@listen/shared";

function getInitialLogLevel(): LogLevelName {
  const envLevel = process.env["LISTEN_LOG_LEVEL"]?.toLowerCase();
  return envLevel && isLogLevelName(envLevel) ? envLevel : DEFAULT_LOG_LEVEL;
}

const subLoggers = new Map<string, Logger<unknown>>();

export function createLogger(name: string): Logger<unknown> {
  const existing = subLoggers.get(name);
  if (existing) {
    return existing;
  }
  const subLogger = logger.getSubLogger({ name });
  subLoggers.set(name, subLogger);
  return subLogger;
}

export const logger = new Logger({
  name: "listen",
  minLevel: LOG_LEVELS[getInitialLogLevel()],
  type: "pretty",
});

export function setLogLevel(level: LogLevelName): void {
  logger.settings.minLevel = LOG_LEVELS[level];
  for (const subLogger of subLoggers.values()) {
    subLogger.settings.minLevel = LOG_LEVELS[level];
  }
}

export function getLogLevel(): LogLevelName {
  return LOG_LEVEL_NAMES[logger.settings.minLevel] ?? DEFAULT_LOG_LEVEL;
}

export function isLogLevelFromEnv(): boolean {
  const envLevel = process.env["LISTEN_LOG_LEVEL"]?.toLowerCase();
  return Boolean(envLevel && isLogLevelName(envLevel));
}

export function errorLogFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (typeof error === "object" && error !== null) {
    return { error: redactLogValue(error) };
  }
  return { error: String(error) };
}

function redactLogValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactLogValue);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    shouldRedactLogKey(key) ? "[redacted]" : redactLogValue(entry),
  ]));
}

function shouldRedactLogKey(key: string): boolean {
  return /token|cookie|authorization|auth|passkey|credential|secret|private|publickey|p256dh/i.test(key);
}
