import {
  createWebAppCli,
  type WebAppCliCommandDefinition,
} from "@pablozaiden/webapp/cli";
import {
  createRouteCatalog,
  readRuntimeConfig,
} from "@pablozaiden/webapp/server";
import { createWebhookRateLimiter } from "../core/webhook-rate-limit";
import { runConfigCommand } from "./config";
import { runNotifyCommand } from "./notify";
import {
  createRoutes,
  getWebhookCallerKey,
  startServer,
} from "../server";
import { LISTEN_VERSION } from "../version";

const LISTEN_UPDATER = {
  repository: "pablozaiden/listen",
  binaryName: "listen",
  currentVersion: LISTEN_VERSION,
  productName: "Listen",
  checksum: { required: true },
};

function configCommand(): WebAppCliCommandDefinition {
  return {
    description: "Manage Listen webhook configuration.",
    usage: "config <set-webhook-url|show|clear> [value]",
    override: true,
    handler: ({ args }) => runConfigCommand(args),
  };
}

function notifyCommand(): WebAppCliCommandDefinition {
  return {
    description: "Send a notification through the configured webhook.",
    usage: "notify --title TITLE --description TEXT [--markdown TEXT | --markdown-file PATH]",
    handler: ({ args }) => runNotifyCommand(args),
  };
}

function routeCatalog() {
  const runtimeConfig = readRuntimeConfig({
    appName: "Listen",
    envPrefix: "LISTEN",
  });
  return createRouteCatalog(createRoutes(
    runtimeConfig,
    createWebhookRateLimiter(),
    getWebhookCallerKey,
  ));
}

export function createListenCli() {
  return createWebAppCli({
    appName: "Listen",
    commandName: "listen",
    envPrefix: "LISTEN",
    version: LISTEN_VERSION,
    realtimePath: "/api/ws",
    routeCatalog,
    start: () => startServer(),
    update: LISTEN_UPDATER,
    commands: {
      config: configCommand(),
      notify: notifyCommand(),
    },
  });
}
