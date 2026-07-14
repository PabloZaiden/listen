import type { Server } from "bun";
import listenIcon192Path from "./web/icons/listen-192.png" with { type: "file" };
import listenIcon512Path from "./web/icons/listen-512.png" with { type: "file" };
import appleTouchIconPath from "./web/icons/apple-touch-icon.png" with { type: "file" };
import { createWebAppPublicAsset, createWebAppServer, defineRoutes, errorResponse, getRequestBaseUrl, getRequestOriginInfo, jsonResponse, notFound, parseJson, readRuntimeConfig, sqliteWebAppStore, successResponse, type ResourceRealtimeEvent, type RuntimeConfig, type WebAppServer, type WebAppWebSocketData } from "@pablozaiden/webapp/server";
import { browserPushEndpointRequestSchema, browserPushSubscribeRequestSchema, createSourceRequestSchema, listNotificationsQuerySchema, sourceMutationResponseSchema, type WebhookNotificationRequest, webhookNotificationRequestSchema } from "@listen/contracts";
import { WEBHOOK_JSON_BODY_MAX_BYTES } from "@listen/shared";
import { createLogger, setLogLevel } from "./core/logger";
import { verifyWebhookToken } from "./core/webhook-tokens";
import { createNotificationFromWebhook, deleteNotification, deleteNotifications, listNotifications, markNotificationRead, markNotificationUnread, markNotificationsRead, openNotification } from "./core/notifications";
import { createSource, deleteSourceAndNotifications, getSourceForWebhook, listSources, markSourceUsed, rotateSourceToken } from "./core/sources";
import { getBrowserPushConfig, getBrowserPushSubscriptionStatus, subscribeBrowserPush, unsubscribeBrowserPush } from "./core/browser-push";
import { initializeDatabase } from "./persistence/database";
import { LISTEN_VERSION } from "./version";
import { createWebhookRateLimiter, type WebhookRateLimitDecision, type WebhookRateLimiter } from "./core/webhook-rate-limit";
import { parseQuery } from "./api/validation";
import { SERVICE_WORKER_ASSET } from "./web/service-worker-asset";

type ListenRealtimeEvent = ResourceRealtimeEvent;

const log = createLogger("server");
const webhookLog = createLogger("api:webhooks");

function rateLimitedResponse(decision: Extract<WebhookRateLimitDecision, { allowed: false }>): Response {
  return errorResponse(429, "rate_limited", "Too many webhook requests", undefined, {
    headers: { "retry-after": String(decision.retryAfterSeconds) },
  });
}

type WebhookRequestServer = Pick<Server<unknown>, "requestIP">;
export type WebhookCallerKeyResolver = (req: Request, server: WebhookRequestServer | undefined) => string;

export function getWebhookCallerKey(req: Request, server: WebhookRequestServer | undefined): string {
  // The framework's trustProxy settings do not expose a trusted client-address header.
  return server?.requestIP(req)?.address?.trim() || "unknown";
}

interface ListenServerOptions {
  webhookRateLimiter?: WebhookRateLimiter;
  webhookCallerKeyResolver?: WebhookCallerKeyResolver;
}

function createRoutes(
  runtimeConfig: RuntimeConfig,
  webhookRateLimiter: WebhookRateLimiter,
  webhookCallerKeyResolver: WebhookCallerKeyResolver,
) {
  return defineRoutes<ListenRealtimeEvent>({
  "/api/sources": {
    auth: "user",
    requestSchema: createSourceRequestSchema,
    GET: (_req, ctx) => {
      const user = ctx.requireUser();
      return jsonResponse({ sources: listSources(user.id) });
    },
    async POST(req, ctx) {
      const user = ctx.requireUser();
      const body = await parseJson(req, createSourceRequestSchema);
      const source = await createSource(body.name, getRequestBaseUrl(req, runtimeConfig), user.id);
      ctx.userRealtime.publishEntityChanged("sources", source.source.id, { payload: source.source });
      return jsonResponse(sourceMutationResponseSchema.parse(source), { status: 201 });
    },
  },
  "/api/sources/:id/token/rotate": {
    auth: "user",
    responseSchema: sourceMutationResponseSchema,
    async POST(req, ctx) {
      const user = ctx.requireUser();
      const source = await rotateSourceToken(ctx.params.id ?? "", getRequestBaseUrl(req, runtimeConfig), user.id);
      if (!source) return notFound();
      ctx.userRealtime.publishEntityChanged("sources", source.source.id, { payload: source.source });
      return jsonResponse(sourceMutationResponseSchema.parse(source));
    },
  },
  "/api/sources/:id": {
    auth: "user",
    DELETE: (_req, ctx) => {
      const user = ctx.requireUser();
      if (!deleteSourceAndNotifications(ctx.params.id ?? "", user.id)) return notFound();
      ctx.userRealtime.publishDeleted("sources", ctx.params.id ?? "");
      ctx.userRealtime.publishChanged("notifications");
      return successResponse();
    },
  },
  "/api/notifications": {
    auth: "user",
    querySchema: listNotificationsQuerySchema,
    GET: (req, ctx) => {
      const user = ctx.requireUser();
      const query = parseQuery(req, listNotificationsQuerySchema);
      if (query instanceof Response) return query;
      return jsonResponse(listNotifications({
        userId: user.id,
        ...query,
      }));
    },
    DELETE: (req, ctx) => {
      const user = ctx.requireUser();
      const query = parseQuery(req, listNotificationsQuerySchema);
      if (query instanceof Response) return query;
      const deletedCount = deleteNotifications({
        userId: user.id,
        sourceId: query.sourceId,
        opened: query.opened,
      });
      ctx.userRealtime.publishChanged("notifications");
      return jsonResponse({ deletedCount });
    },
  },
  "/api/notifications/read": {
    auth: "user",
    POST: (req, ctx) => {
      const user = ctx.requireUser();
      const url = new URL(req.url);
      const updatedCount = markNotificationsRead(user.id, url.searchParams.get("sourceId") || undefined);
      ctx.userRealtime.publishChanged("notifications");
      return successResponse({ success: true, updatedCount });
    },
  },
  "/api/notifications/:id": {
    auth: "user",
    GET: (_req, ctx) => {
      const user = ctx.requireUser();
      const notification = openNotification(ctx.params.id ?? "", user.id);
      if (!notification) return notFound();
      ctx.userRealtime.publishEntityChanged("notifications", notification.id);
      return jsonResponse({ notification });
    },
    DELETE: (_req, ctx) => {
      const user = ctx.requireUser();
      if (!deleteNotification(ctx.params.id ?? "", user.id)) return notFound();
      ctx.userRealtime.publishDeleted("notifications", ctx.params.id ?? "");
      return successResponse();
    },
  },
  "/api/notifications/:id/read": {
    auth: "user",
    POST: (_req, ctx) => {
      const user = ctx.requireUser();
      const notification = markNotificationRead(ctx.params.id ?? "", user.id);
      if (!notification) return notFound();
      ctx.userRealtime.publishEntityChanged("notifications", notification.id);
      return jsonResponse({ notification });
    },
  },
  "/api/notifications/:id/unread": {
    auth: "user",
    POST: (_req, ctx) => {
      const user = ctx.requireUser();
      const notification = markNotificationUnread(ctx.params.id ?? "", user.id);
      if (!notification) return notFound();
      ctx.userRealtime.publishEntityChanged("notifications", notification.id);
      return jsonResponse({ notification });
    },
  },
  "/api/browser-push/config": {
    auth: "user",
    GET: (req, ctx) => {
      ctx.requireUser();
      return jsonResponse(getBrowserPushConfig(getRequestOriginInfo(req, runtimeConfig).origin));
    },
  },
  "/api/browser-push/subscriptions": {
    auth: "user",
    async POST(req, ctx) {
      const user = ctx.requireUser();
      const body = await parseJson(req, browserPushSubscribeRequestSchema);
      return jsonResponse(subscribeBrowserPush(body.subscription, req, user.id), { status: 201 });
    },
    async DELETE(req, ctx) {
      const user = ctx.requireUser();
      const body = await parseJson(req, browserPushEndpointRequestSchema);
      return jsonResponse(unsubscribeBrowserPush(body.endpoint, user.id));
    },
  },
  "/api/browser-push/subscriptions/lookup": {
    auth: "user",
    async POST(req, ctx) {
      const user = ctx.requireUser();
      const body = await parseJson(req, browserPushEndpointRequestSchema);
      return jsonResponse(getBrowserPushSubscriptionStatus(body.endpoint, user.id));
    },
  },
  "/api/webhooks/:sourceId/:token": {
    auth: "public",
    sameOrigin: "never",
    requestSchema: webhookNotificationRequestSchema,
    async POST(req, ctx) {
      const callerRateLimit = webhookRateLimiter.checkCaller(webhookCallerKeyResolver(req, ctx.server));
      if (!callerRateLimit.allowed) {
        webhookLog.debug("Webhook caller rate limit exceeded");
        return rateLimitedResponse(callerRateLimit);
      }
      const emergencyRateLimit = webhookRateLimiter.checkEmergencyGlobal();
      if (!emergencyRateLimit.allowed) {
        webhookLog.debug("Emergency global webhook rate limit exceeded");
        return rateLimitedResponse(emergencyRateLimit);
      }
      const source = getSourceForWebhook(ctx.params.sourceId ?? "");
      if (!source) {
        webhookLog.warn("Webhook source not found", { sourceId: ctx.params.sourceId });
        return errorResponse(404, "source_not_found", "Webhook source was not found");
      }
      if (!await verifyWebhookToken(ctx.params.token ?? "", source.tokenHash)) {
        webhookLog.warn("Webhook token invalid", { sourceId: source.id });
        return errorResponse(401, "invalid_webhook_token", "Webhook token is invalid");
      }
      const sourceRateLimit = webhookRateLimiter.checkSource(source.id);
      if (!sourceRateLimit.allowed) {
        webhookLog.debug("Source webhook rate limit exceeded", { sourceId: source.id });
        return rateLimitedResponse(sourceRateLimit);
      }
      const body: WebhookNotificationRequest = await parseJson(req, webhookNotificationRequestSchema, {
        maxBytes: WEBHOOK_JSON_BODY_MAX_BYTES,
        requireContentType: true,
      });
      const notification = createNotificationFromWebhook(body, source, { publicOrigin: getRequestOriginInfo(req, runtimeConfig).origin });
      markSourceUsed(source.id, source.userId);
      ctx.realtime.publishEntityChanged("notifications", notification.id, { target: { userId: source.userId }, payload: notification });
      ctx.realtime.publishEntityChanged("sources", source.id, { target: { userId: source.userId } });
      return jsonResponse({ id: notification.id }, { status: 201 });
    },
  },
  });
}

let app: WebAppServer<ListenRealtimeEvent> | undefined;

export function getWebAppServer(): WebAppServer<ListenRealtimeEvent> {
  if (app) return app;
  const runtimeConfig = readRuntimeConfig({ appName: "Listen", envPrefix: "LISTEN" });
  app = createListenWebAppServer(runtimeConfig);
  return app;
}

function createListenWebAppServer(
  runtimeConfig: RuntimeConfig,
  options: ListenServerOptions = {},
): WebAppServer<ListenRealtimeEvent> {
  const dataDir = runtimeConfig.dataDir;
  initializeDatabase(dataDir);
  const store = sqliteWebAppStore({ dataDir, fileName: "listen.db" });
  const webhookRateLimiter = options.webhookRateLimiter ?? createWebhookRateLimiter();
  const webhookCallerKeyResolver = options.webhookCallerKeyResolver ?? getWebhookCallerKey;
  const server = createWebAppServer<ListenRealtimeEvent>({
    appName: "Listen",
    envPrefix: "LISTEN",
    runtimeConfig,
    web: {
      icons: {
        favicon: { src: listenIcon192Path, sizes: "192x192", type: "image/png" },
        appleTouch: { src: appleTouchIconPath, sizes: "180x180", type: "image/png" },
        manifest: [
          { src: listenIcon192Path, sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: listenIcon512Path, sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
    },
    version: LISTEN_VERSION,
    store,
    auth: { passkeys: true, apiKeys: true, deviceAuth: true },
    logLevel: { onChange: setLogLevel },
    realtime: { path: "/api/ws" },
    routes: createRoutes(runtimeConfig, webhookRateLimiter, webhookCallerKeyResolver),
    publicRoutes: { [SERVICE_WORKER_ASSET.path]: createWebAppPublicAsset(SERVICE_WORKER_ASSET) },
  });
  return server;
}

export interface ListenTestOptions {
  host?: RuntimeConfig["host"];
  port?: RuntimeConfig["port"];
  dataDir?: RuntimeConfig["dataDir"];
  passkeyDisabled?: RuntimeConfig["passkeyDisabled"];
  sameOriginDisabled?: RuntimeConfig["sameOriginDisabled"];
  logLevel?: RuntimeConfig["logLevel"];
  publicBaseUrl?: RuntimeConfig["publicBaseUrl"];
  trustProxy?: RuntimeConfig["trustProxy"];
}

function applyListenTestOptions(config: RuntimeConfig, options: ListenTestOptions): RuntimeConfig {
  return {
    ...config,
    host: options.host ?? config.host,
    port: options.port ?? config.port,
    dataDir: options.dataDir ?? config.dataDir,
    passkeyDisabled: options.passkeyDisabled ?? config.passkeyDisabled,
    sameOriginDisabled: options.sameOriginDisabled ?? config.sameOriginDisabled,
    logLevel: options.logLevel ?? config.logLevel,
    logLevelFromEnv: options.logLevel === undefined ? config.logLevelFromEnv : true,
    publicBaseUrl: options.publicBaseUrl === undefined ? config.publicBaseUrl : options.publicBaseUrl,
    trustProxy: options.trustProxy ?? config.trustProxy,
  };
}

export function createFetchHandler(
  testOptions: ListenTestOptions = {},
  options: ListenServerOptions = {},
): (req: Request, server?: Server<WebAppWebSocketData>) => Promise<Response | undefined> {
  const runtimeConfig = applyListenTestOptions(readRuntimeConfig({ appName: "Listen", envPrefix: "LISTEN" }), testOptions);
  const handlerApp = createListenWebAppServer(runtimeConfig, options);
  return (req, server) => handlerApp.handleRequest(req, server);
}

export async function startServer(): Promise<Server<WebAppWebSocketData>> {
  const server = await getWebAppServer().start();
  log.info(`Listen server started on ${server.hostname}:${server.port}`);
  return server;
}
