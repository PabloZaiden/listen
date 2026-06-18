import { Logger } from "tslog";

const level = process.env["LISTEN_LOG_LEVEL"] ?? "info";
const LEVELS: Record<string, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

export function createLogger(name: string): Logger<unknown> {
  return new Logger({
    name,
    minLevel: LEVELS[level] ?? 2,
    type: "pretty",
  });
}

export const logger = createLogger("listen");
