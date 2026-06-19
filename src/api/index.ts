import type { Server } from "bun";
import { handleBrowserPush } from "./browser-push";
import { configRoute } from "./config";
import { handleNotifications } from "./notifications";
import { handlePasskeyAuth } from "./passkey-auth";
import { handlePreferences } from "./preferences";
import { requirePasskeyAuth } from "./passkey-guard";
import { checkSameOrigin } from "./same-origin-guard";
import { handleServerControl } from "./server-control";
import { handleSources } from "./sources";
import { handleWebhook } from "./webhooks";
import { healthRoute } from "./health";
import { errorResponse, notFound } from "./helpers";
import { withRequestLogging } from "./request-logging";
import { createLogger } from "../core/logger";
import type { ServerConfig } from "../core/server-config";
import type { WebSocketData } from "./websocket/types";

const log = createLogger("api");

function isWebhookPath(pathname: string): boolean {
  return /^\/api\/webhooks\/[^/]+\/[^/]+$/.test(pathname);
}

function isPublicApiPath(pathname: string): boolean {
  return pathname === "/api/health"
    || pathname === "/api/config"
    || pathname === "/api/passkey-auth/status"
    || pathname === "/api/passkey-auth/registration/options"
    || pathname === "/api/passkey-auth/registration/verify"
    || pathname === "/api/passkey-auth/authentication/options"
    || pathname === "/api/passkey-auth/authentication/verify"
    || pathname === "/api/passkey-auth/logout"
    || isWebhookPath(pathname);
}

export async function handleApiRequest(req: Request, config: ServerConfig, server?: Server<WebSocketData>): Promise<Response | undefined> {
  return withRequestLogging(req, async () => {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname === "/api/ws") {
      const sameOriginFailure = checkSameOrigin(req, config, true);
      if (sameOriginFailure) {
        return sameOriginFailure;
      }
      const authFailure = await requirePasskeyAuth(req, config);
      if (authFailure) {
        return authFailure;
      }
      if (!server) {
        log.warn("WebSocket upgrade requested but server is unavailable", { sourceId: url.searchParams.get("sourceId") ?? undefined });
        return errorResponse(400, "websocket_unavailable", "WebSocket server is unavailable");
      }
      const upgraded = server.upgrade(req, {
        data: { sourceId: url.searchParams.get("sourceId") ?? undefined } satisfies WebSocketData,
      });
      log.trace("WebSocket upgrade attempted", { sourceId: url.searchParams.get("sourceId") ?? undefined, upgraded });
      return upgraded ? undefined : errorResponse(400, "websocket_upgrade_failed", "WebSocket upgrade failed");
    }

    if (pathname === "/api/health" && req.method === "GET") {
      return healthRoute();
    }
    if (pathname === "/api/config" && req.method === "GET") {
      return configRoute(req, config);
    }

    const sameOriginFailure = isWebhookPath(pathname) ? undefined : checkSameOrigin(req, config);
    if (sameOriginFailure) {
      return sameOriginFailure;
    }

    const publicWebhook = await handleWebhook(req);
    if (publicWebhook) {
      return publicWebhook;
    }

    const publicPasskeyRoute = await handlePasskeyAuth(req, config);
    if (publicPasskeyRoute && isPublicApiPath(pathname)) {
      return publicPasskeyRoute;
    }

    if (!isPublicApiPath(pathname)) {
      const authFailure = await requirePasskeyAuth(req, config);
      if (authFailure) {
        return authFailure;
      }
    }

    const protectedPasskeyRoute = publicPasskeyRoute ?? await handlePasskeyAuth(req, config);
    if (protectedPasskeyRoute) {
      return protectedPasskeyRoute;
    }

    const serverControlRoute = handleServerControl(req);
    if (serverControlRoute) {
      return serverControlRoute;
    }

    const preferencesRoute = await handlePreferences(req);
    if (preferencesRoute) {
      return preferencesRoute;
    }

    const sourceRoute = await handleSources(req);
    if (sourceRoute) {
      return sourceRoute;
    }

    const notificationRoute = handleNotifications(req);
    if (notificationRoute) {
      return notificationRoute;
    }

    const browserPushRoute = await handleBrowserPush(req);
    if (browserPushRoute) {
      return browserPushRoute;
    }

    return notFound();
  });
}
