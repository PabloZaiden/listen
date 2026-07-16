import { readFile } from "node:fs/promises";
import { decodePngDataUrl, hasPngSignature, webhookNotificationRequestSchema } from "@listen/contracts";
import { readOption, type CliCommandResult } from "@pablozaiden/webapp/cli";
import { configuredWebhookUrl } from "./config";

async function readMarkdown(args: string[]): Promise<string | undefined> {
  const inline = readOption(args, ["--markdown"]);
  const file = readOption(args, ["--markdown-file"]);
  if ((inline && file) || (!inline && !file)) {
    throw new Error("Require exactly one of --markdown or --markdown-file");
  }
  if (inline) {
    return inline
      .replaceAll("\\r\\n", "\n")
      .replaceAll("\\n", "\n")
      .replaceAll("\\r", "\n");
  }
  if (file === "-") {
    return Bun.stdin.text();
  }
  return file ? readFile(file, "utf8") : undefined;
}

async function iconDataUrl(path: string | undefined): Promise<string | undefined> {
  if (!path) {
    return undefined;
  }
  const bytes = new Uint8Array(await readFile(path));
  if (!hasPngSignature(bytes)) {
    throw new Error("--icon-file must point to a PNG file");
  }
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

export async function runNotifyCommand(args: string[]): Promise<CliCommandResult> {
  try {
    const webhookUrl = await configuredWebhookUrl();
    if (!webhookUrl) {
      return { exitCode: 1, error: "No webhook URL configured. Run listen config set-webhook-url <url> or set LISTEN_WEBHOOK_URL." };
    }
    const icon = await iconDataUrl(readOption(args, ["--icon-file"]));
    if (icon && !decodePngDataUrl(icon)) {
      throw new Error("Icon file is invalid");
    }
    const payload = webhookNotificationRequestSchema.parse({
      title: readOption(args, ["--title"]),
      shortDescription: readOption(args, ["--description", "--short-description"]),
      markdownContent: await readMarkdown(args),
      icon,
    });
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await response.text();
    if (!response.ok) {
      return { exitCode: 1, error: `Webhook request failed with status ${response.status}: ${body}` };
    }
    const parsed = JSON.parse(body) as { id?: string };
    return { exitCode: 0, output: parsed.id ? `Notification created: ${parsed.id}` : body };
  } catch (error) {
    return { exitCode: 1, error: error instanceof Error ? error.message : String(error) };
  }
}
