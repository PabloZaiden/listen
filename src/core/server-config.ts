export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  passkeyDisabled: boolean;
  sameOriginCheckDisabled: boolean;
  logLevel: string;
}

export function isTruthyEnv(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes";
}

export function parsePort(value: string | undefined): number {
  const raw = value ?? "3000";
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid LISTEN_PORT "${raw}": expected an integer from 0 to 65535`);
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid LISTEN_PORT "${raw}": expected an integer from 0 to 65535`);
  }
  return port;
}

export function readServerConfig(): ServerConfig {
  return {
    host: process.env["LISTEN_HOST"] ?? "127.0.0.1",
    port: parsePort(process.env["LISTEN_PORT"]),
    dataDir: process.env["LISTEN_DATA_DIR"] ?? "./data",
    passkeyDisabled: isTruthyEnv(process.env["LISTEN_DISABLE_PASSKEY"]),
    sameOriginCheckDisabled: isTruthyEnv(process.env["LISTEN_DISABLE_SAME_ORIGIN_CHECK"]),
    logLevel: process.env["LISTEN_LOG_LEVEL"] ?? "info",
  };
}
