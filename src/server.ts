import type { Server } from "bun";
import webIndex from "./index.html";
// @ts-expect-error Bun supports importing a TypeScript file as raw text with this import attribute.
import serviceWorkerSource from "./web/service-worker.ts" with { type: "text" };
import listenIcon192Path from "./web/icons/listen-192.png" with { type: "file" };
import listenIcon512Path from "./web/icons/listen-512.png" with { type: "file" };
import appleTouchIconPath from "./web/icons/apple-touch-icon.png" with { type: "file" };
import { createWebAppServer, defineRoutes, errorResponse, jsonResponse, parseJson, sqliteWebAppStore, successResponse, type ResourceRealtimeEvent, type RouteContext, type WebAppServer, type WebAppWebSocketData } from "@pablozaiden/webapp/server";
import type { CurrentUser } from "@pablozaiden/webapp/contracts";
import type { BrowserPushSubscription, WebhookNotificationRequest } from "@listen/contracts";
import { webhookNotificationRequestSchema } from "@listen/contracts";
import { BROWSER_PUSH_ENDPOINT_MAX_CHARS, isLogLevelName, NOTIFICATION_SOURCE_NAME_MAX_CHARS } from "@listen/shared";
import { createLogger, setLogLevel } from "./core/logger";
import { getRequestOrigin } from "./core/request-origin";
import { verifyWebhookToken } from "./core/webhook-tokens";
import { createNotificationFromWebhook, deleteNotification, deleteNotifications, listNotifications, markNotificationRead, markNotificationUnread, markNotificationsRead, openNotification } from "./core/notifications";
import { createSource, deleteSourceAndNotifications, getSourceForWebhook, listSources, markSourceUsed, rotateSourceToken } from "./core/sources";
import { getBrowserPushConfig, getBrowserPushSubscriptionStatus, subscribeBrowserPush, unsubscribeBrowserPush } from "./core/browser-push";
import { initializeDatabase } from "./persistence/database";
import { readServerConfig, type ServerConfig } from "./core/server-config";
import { LISTEN_VERSION } from "./version";
import { checkGlobalWebhookRateLimit, checkSourceWebhookRateLimit, type WebhookRateLimitDecision } from "./core/webhook-rate-limit";
import { parseJsonBody, parseWithSchema, RequestValidationError } from "./api/validation";

type ListenRealtimeEvent = ResourceRealtimeEvent;

const log = createLogger("server");
const webhookLog = createLogger("api:webhooks");
const SERVICE_WORKER_PATH = "/service-worker";
const WEB_APP_ICON_192_PATH = "/web-app-manifest-192x192.png";
const WEB_APP_ICON_512_PATH = "/web-app-manifest-512x512.png";
const APPLE_TOUCH_ICON_PATH = "/apple-touch-icon.png";
const serviceWorkerScript = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(serviceWorkerSource);
const WEB_ICON_PATHS = new Map([
  [WEB_APP_ICON_192_PATH, listenIcon192Path],
  [WEB_APP_ICON_512_PATH, listenIcon512Path],
  [APPLE_TOUCH_ICON_PATH, appleTouchIconPath],
]);

function serviceWorkerResponse(): Response {
  return new Response(serviceWorkerScript, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "service-worker-allowed": "/",
      "cache-control": "no-cache",
    },
  });
}

function iconResponse(pathname: string): Response | undefined {
  const iconPath = WEB_ICON_PATHS.get(pathname);
  return iconPath ? new Response(Bun.file(iconPath), { headers: { "content-type": "image/png" } }) : undefined;
}

function badRequest(message: string): Response {
  return errorResponse(400, "invalid_request", message);
}

function notFound(): Response {
  return errorResponse(404, "not_found", "Resource not found");
}

function rateLimitedResponse(decision: Extract<WebhookRateLimitDecision, { allowed: false }>): Response {
  return errorResponse(429, "rate_limited", "Too many webhook requests", undefined, {
    headers: { "retry-after": String(decision.retryAfterSeconds) },
  });
}

function parseLimit(raw: string | null, fallback: number): number {
  const value = raw ? Number(raw) : fallback;
  return Number.isInteger(value) && value > 0 && value <= 100 ? value : fallback;
}

function parseOffset(raw: string | null): number {
  const value = raw ? Number(raw) : 0;
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createOwnerRecord(username: string) {
  const timestamp = nowIso();
  return {
    id: crypto.randomUUID(),
    username,
    role: "owner" as const,
    passkeyConfigured: false,
    authVersion: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function toCurrentUser(user: ReturnType<WebAppServer<ListenRealtimeEvent>["store"]["getOwnerUser"]>): CurrentUser {
  if (!user) {
    throw new Error("Owner user is required");
  }
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    isOwner: user.role === "owner",
    isAdmin: user.role === "owner" || user.role === "admin",
  };
}

function ensureAdminOwner(appServer: WebAppServer<ListenRealtimeEvent>): CurrentUser {
  const existing = appServer.store.getOwnerUser();
  if (existing) return toCurrentUser(existing);
  const owner = createOwnerRecord("admin");
  appServer.store.createUser(owner);
  return toCurrentUser(owner);
}

function requireListenUser(ctx: RouteContext<Record<string, string>, ListenRealtimeEvent>): CurrentUser {
  if (ctx.user) return ctx.user;
  const appServer = getWebAppServer();
  if (appServer.config.passkeyDisabled) {
    return ensureAdminOwner(appServer);
  }
  return ctx.requireUser();
}

const routes = defineRoutes<ListenRealtimeEvent>({
  "/api/sources": {
    auth: "user",
    GET: (_req, ctx) => {
      const user = requireListenUser(ctx);
      return jsonResponse({ sources: listSources(true, user.id) });
    },
    async POST(req, ctx) {
      const user = requireListenUser(ctx);
      const body = await parseJson<{ name?: string }>(req);
      const name = body.name?.trim() ?? "";
      if (!name) return badRequest("Source name is required.");
      if (name.length > NOTIFICATION_SOURCE_NAME_MAX_CHARS) return badRequest(`Source names must be ${NOTIFICATION_SOURCE_NAME_MAX_CHARS} characters or fewer.`);
      const source = await createSource(name, req, user.id);
      ctx.realtime.publishEntityChanged("sources", source.source.id, { target: { userId: user.id }, payload: source.source });
      return jsonResponse(source, { status: 201 });
    },
  },
  "/api/sources/:id/token/rotate": {
    auth: "user",
    async POST(req, ctx) {
      const user = requireListenUser(ctx);
      const source = await rotateSourceToken(ctx.params.id ?? "", req, user.id);
      if (!source) return notFound();
      ctx.realtime.publishEntityChanged("sources", source.source.id, { target: { userId: user.id }, payload: source.source });
      return jsonResponse(source);
    },
  },
  "/api/sources/:id": {
    auth: "user",
    DELETE: (_req, ctx) => {
      const user = requireListenUser(ctx);
      if (!deleteSourceAndNotifications(ctx.params.id ?? "", user.id)) return notFound();
      ctx.realtime.publishDeleted("sources", ctx.params.id ?? "", { target: { userId: user.id } });
      ctx.realtime.publishChanged("notifications", { target: { userId: user.id } });
      return successResponse();
    },
  },
  "/api/notifications": {
    auth: "user",
    GET: (req, ctx) => {
      const user = requireListenUser(ctx);
      const url = new URL(req.url);
      return jsonResponse(listNotifications({
        userId: user.id,
        limit: parseLimit(url.searchParams.get("limit"), 50),
        offset: parseOffset(url.searchParams.get("offset")),
        sourceId: url.searchParams.get("sourceId") || undefined,
        opened: url.searchParams.get("opened") === "true" ? true : url.searchParams.get("opened") === "false" ? false : undefined,
      }));
    },
    DELETE: (req, ctx) => {
      const user = requireListenUser(ctx);
      const url = new URL(req.url);
      const deletedCount = deleteNotifications({
        userId: user.id,
        sourceId: url.searchParams.get("sourceId") || undefined,
        opened: url.searchParams.get("opened") === "true" ? true : url.searchParams.get("opened") === "false" ? false : undefined,
      });
      ctx.realtime.publishChanged("notifications", { target: { userId: user.id } });
      return jsonResponse({ deletedCount });
    },
  },
  "/api/notifications/mark-read": {
    auth: "user",
    POST: (req, ctx) => {
      const user = requireListenUser(ctx);
      const url = new URL(req.url);
      const updatedCount = markNotificationsRead(user.id, url.searchParams.get("sourceId") || undefined);
      ctx.realtime.publishChanged("notifications", { target: { userId: user.id } });
      return jsonResponse({ updatedCount });
    },
  },
  "/api/notifications/read": {
    auth: "user",
    POST: (req, ctx) => {
      const user = requireListenUser(ctx);
      const url = new URL(req.url);
      const updatedCount = markNotificationsRead(user.id, url.searchParams.get("sourceId") || undefined);
      ctx.realtime.publishChanged("notifications", { target: { userId: user.id } });
      return successResponse({ success: true, updatedCount });
    },
  },
  "/api/notifications/:id": {
    auth: "user",
    GET: (_req, ctx) => {
      const user = requireListenUser(ctx);
      const notification = openNotification(ctx.params.id ?? "", user.id);
      if (!notification) return notFound();
      ctx.realtime.publishEntityChanged("notifications", notification.id, { target: { userId: user.id } });
      return jsonResponse({ notification });
    },
    DELETE: (_req, ctx) => {
      const user = requireListenUser(ctx);
      if (!deleteNotification(ctx.params.id ?? "", user.id)) return notFound();
      ctx.realtime.publishDeleted("notifications", ctx.params.id ?? "", { target: { userId: user.id } });
      return successResponse();
    },
  },
  "/api/notifications/:id/read": {
    auth: "user",
    POST: (_req, ctx) => {
      const user = requireListenUser(ctx);
      const notification = markNotificationRead(ctx.params.id ?? "", user.id);
      if (!notification) return notFound();
      ctx.realtime.publishEntityChanged("notifications", notification.id, { target: { userId: user.id } });
      return jsonResponse({ notification });
    },
  },
  "/api/notifications/:id/unread": {
    auth: "user",
    POST: (_req, ctx) => {
      const user = requireListenUser(ctx);
      const notification = markNotificationUnread(ctx.params.id ?? "", user.id);
      if (!notification) return notFound();
      ctx.realtime.publishEntityChanged("notifications", notification.id, { target: { userId: user.id } });
      return jsonResponse({ notification });
    },
  },
  "/api/browser-push/config": {
    auth: "user",
    GET: (req, ctx) => {
      requireListenUser(ctx);
      return jsonResponse(getBrowserPushConfig(req));
    },
  },
  "/api/browser-push/subscriptions": {
    auth: "user",
    async POST(req, ctx) {
      const user = requireListenUser(ctx);
      const body = await parseJson<{ subscription?: BrowserPushSubscription }>(req);
      if (!body.subscription) return badRequest("subscription is required.");
      const endpoint = body.subscription.endpoint.trim();
      if (!endpoint || endpoint.length > BROWSER_PUSH_ENDPOINT_MAX_CHARS) return badRequest("Valid endpoint is required.");
      return jsonResponse(subscribeBrowserPush({ ...body.subscription, endpoint }, req, user.id), { status: 201 });
    },
    async DELETE(req, ctx) {
      const user = requireListenUser(ctx);
      const body = await parseJson<{ endpoint?: string }>(req);
      const endpoint = body.endpoint?.trim() ?? "";
      if (!endpoint || endpoint.length > BROWSER_PUSH_ENDPOINT_MAX_CHARS) return badRequest("Valid endpoint is required.");
      return jsonResponse(unsubscribeBrowserPush(endpoint, user.id));
    },
  },
  "/api/browser-push/subscriptions/lookup": {
    auth: "user",
    async POST(req, ctx) {
      const user = requireListenUser(ctx);
      const body = await parseJson<{ endpoint?: string }>(req);
      const endpoint = body.endpoint?.trim() ?? "";
      if (!endpoint || endpoint.length > BROWSER_PUSH_ENDPOINT_MAX_CHARS) return badRequest("Valid endpoint is required.");
      return jsonResponse(getBrowserPushSubscriptionStatus(endpoint, user.id));
    },
  },
  "/api/webhooks/:sourceId/:token": {
    auth: "public",
    sameOrigin: "never",
    async POST(req, ctx) {
      const globalRateLimit = checkGlobalWebhookRateLimit();
      if (!globalRateLimit.allowed) {
        webhookLog.debug("Global webhook rate limit exceeded");
        return rateLimitedResponse(globalRateLimit);
      }
      const source = getSourceForWebhook(ctx.params.sourceId ?? "");
      if (!source) {
        webhookLog.warn("Webhook source not found", { sourceId: ctx.params.sourceId });
        return errorResponse(404, "source_not_found", "Webhook source was not found");
      }
      if (source.disabledAt) {
        webhookLog.warn("Webhook source disabled", { sourceId: source.id });
        return errorResponse(410, "source_disabled", "Webhook source is disabled");
      }
      if (!await verifyWebhookToken(ctx.params.token ?? "", source.tokenHash)) {
        webhookLog.warn("Webhook token invalid", { sourceId: source.id });
        return errorResponse(401, "invalid_webhook_token", "Webhook token is invalid");
      }
      const sourceRateLimit = checkSourceWebhookRateLimit(source.id);
      if (!sourceRateLimit.allowed) {
        webhookLog.debug("Source webhook rate limit exceeded", { sourceId: source.id });
        return rateLimitedResponse(sourceRateLimit);
      }
      let body: WebhookNotificationRequest;
      try {
        body = parseWithSchema(webhookNotificationRequestSchema, await parseJsonBody(req));
      } catch (error) {
        if (error instanceof RequestValidationError) {
          webhookLog.warn("Webhook request validation failed", { sourceId: source.id, message: error.message });
          return error.response;
        }
        throw error;
      }
      const notification = createNotificationFromWebhook(body, source, { publicOrigin: getRequestOrigin(req).origin });
      markSourceUsed(source.id);
      ctx.realtime.publishEntityChanged("notifications", notification.id, { target: { userId: source.userId }, payload: notification });
      ctx.realtime.publishEntityChanged("sources", source.id, { target: { userId: source.userId } });
      return jsonResponse({ id: notification.id }, { status: 201 });
    },
  },
});

let app: WebAppServer<ListenRealtimeEvent> | undefined;

export function getWebAppServer(): WebAppServer<ListenRealtimeEvent> {
  if (app) return app;
  const dataDir = process.env["LISTEN_DATA_DIR"] ?? "./data";
  initializeDatabase(dataDir);
  const store = sqliteWebAppStore({ dataDir, fileName: "listen.db" });
  app = createWebAppServer<ListenRealtimeEvent>({
    appName: "Listen",
    envPrefix: "LISTEN",
    index: webIndex,
    version: LISTEN_VERSION,
    store,
    auth: { passkeys: true, apiKeys: true, deviceAuth: true },
    logLevel: { onChange: setLogLevel },
    realtime: { path: "/api/ws" },
    pwa: {
      shortName: "Listen",
      themeColor: "#111827",
      backgroundColor: "#f3f4f6",
      display: "standalone",
      startUrl: "/",
      scope: "/",
    },
    routes,
    publicRoutes: {
      [SERVICE_WORKER_PATH]: { GET: serviceWorkerResponse },
      [WEB_APP_ICON_192_PATH]: { GET: () => iconResponse(WEB_APP_ICON_192_PATH) },
      [WEB_APP_ICON_512_PATH]: { GET: () => iconResponse(WEB_APP_ICON_512_PATH) },
      [APPLE_TOUCH_ICON_PATH]: { GET: () => iconResponse(APPLE_TOUCH_ICON_PATH) },
    },
  });
  return app;
}

export function createFetchHandler(_config: ServerConfig = readServerConfig()): (req: Request, server?: Server<WebAppWebSocketData>) => Promise<Response | undefined> {
  process.env["LISTEN_HOST"] = _config.host;
  process.env["LISTEN_PORT"] = String(_config.port);
  process.env["LISTEN_DATA_DIR"] = _config.dataDir;
  if (_config.logLevel !== "info" || process.env["LISTEN_LOG_LEVEL"] !== undefined) {
    process.env["LISTEN_LOG_LEVEL"] = _config.logLevel;
  }
  if (isLogLevelName(_config.logLevel)) {
    setLogLevel(_config.logLevel);
  }
  process.env["LISTEN_DISABLE_PASSKEY"] = _config.passkeyDisabled ? "true" : "false";
  process.env["LISTEN_DISABLE_SAME_ORIGIN_CHECK"] = _config.sameOriginCheckDisabled ? "true" : "false";
  app = undefined;
  return (req, server) => getWebAppServer().handleRequest(req, server);
}

export function startServer(_config = readServerConfig()): Server<WebAppWebSocketData> {
  const server = getWebAppServer().start();
  log.info(`Listen server started on ${server.hostname}:${server.port}`);
  return server;
}
