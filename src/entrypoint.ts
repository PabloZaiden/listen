import { dispatchCliCommand, printCliResult } from "@pablozaiden/webapp/cli";
import { startServer } from "./server";
import { LISTEN_VERSION } from "./version";
import { runConfigCommand } from "./cli/config";
import { runNotifyCommand } from "./cli/notify";
import { runUpdateCommand } from "./cli/update";

const HELP = `Listen - passkey-protected notification inbox for agents

Usage:
  listen help
  listen version
  listen update [--check] [--version <version>]
  listen serve
  listen config set-webhook-url <url>
  listen config show
  listen config clear
  listen notify --title <title> --description <text> --markdown <markdown>
  listen notify --title <title> --description <text> --markdown-file <path|->
  listen notify --title <title> --description <text> --markdown <markdown> --icon-file <png-path>
`;

export async function runMain(args: string[]): Promise<number | undefined> {
  if (args[0] === "serve") {
    await startServer();
    return undefined;
  }
  const result = await dispatchCliCommand({
    args,
    help: HELP,
    commands: {
      version: () => ({ exitCode: 0, output: LISTEN_VERSION }),
      config: runConfigCommand,
      notify: runNotifyCommand,
      update: runUpdateCommand,
    },
  });
  return printCliResult(result);
}
