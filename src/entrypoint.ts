import { startServer } from "./server";
import { LISTEN_VERSION } from "./version";
import { runConfigCommand } from "./cli/config";
import { runNotifyCommand } from "./cli/notify";
import { printResult } from "./cli/runtime";
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
  const command = args[0];
  if (!command || command === "-h" || command === "--help") {
    console.log(HELP);
    return command ? 0 : 1;
  }
  if (command === "help") {
    console.log(HELP);
    return 0;
  }
  if (command === "version") {
    console.log(LISTEN_VERSION);
    return 0;
  }
  if (command === "serve") {
    await startServer();
    return undefined;
  }
  if (command === "config") {
    return printResult(await runConfigCommand(args.slice(1)));
  }
  if (command === "notify") {
    return printResult(await runNotifyCommand(args.slice(1)));
  }
  if (command === "update") {
    return printResult(await runUpdateCommand(args.slice(1)));
  }
  console.error(`Unknown command: ${command}`);
  console.log(HELP);
  return 1;
}
