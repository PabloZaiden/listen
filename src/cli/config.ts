import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import type { CliCommandResult } from "./runtime";

export interface ListenCliConfig {
  webhookUrl: string;
}

function homeDir(): string {
  const home = process.env["HOME"];
  if (!home) {
    throw new Error("HOME is not set");
  }
  return home;
}

export function configDir(): string {
  return join(homeDir(), ".listen");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function validateWebhookUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Webhook URL must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Webhook URL must use http or https");
  }
  return url.toString();
}

export async function readConfig(): Promise<ListenCliConfig | undefined> {
  try {
    const parsed = JSON.parse(await readFile(configPath(), "utf8")) as Partial<ListenCliConfig>;
    if (!parsed.webhookUrl) {
      return undefined;
    }
    return { webhookUrl: validateWebhookUrl(parsed.webhookUrl) };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function writeConfig(config: ListenCliConfig): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  try {
    chmodSync(configDir(), 0o700);
  } catch {
    // Best-effort permission tightening on platforms that support it.
  }
  await writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(configPath(), 0o600);
  } catch {
    // Best-effort permission tightening on platforms that support it.
  }
}

export async function clearConfig(): Promise<void> {
  await rm(configPath(), { force: true });
}

export async function configuredWebhookUrl(): Promise<string | undefined> {
  const envUrl = process.env["LISTEN_WEBHOOK_URL"];
  if (envUrl) {
    return validateWebhookUrl(envUrl);
  }
  return (await readConfig())?.webhookUrl;
}

export async function runConfigCommand(args: string[]): Promise<CliCommandResult> {
  const subcommand = args[0];
  if (subcommand === "set-webhook-url") {
    const rawUrl = args[1];
    if (!rawUrl) {
      return { exitCode: 1, error: "Usage: listen config set-webhook-url <url>" };
    }
    await writeConfig({ webhookUrl: validateWebhookUrl(rawUrl) });
    return { exitCode: 0, output: `Webhook URL saved to ${configPath()}` };
  }
  if (subcommand === "show") {
    const config = await readConfig();
    return { exitCode: 0, output: config ? JSON.stringify(config, null, 2) : "No Listen config is set." };
  }
  if (subcommand === "clear") {
    await clearConfig();
    return { exitCode: 0, output: "Listen config cleared." };
  }
  return { exitCode: 1, error: "Usage: listen config <set-webhook-url|show|clear>" };
}
