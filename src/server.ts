import type { Server } from "bun";
import listenIconSvgPath from "./web/icons/listen.svg" with { type: "file" };
import listenIcon192Path from "./web/icons/listen-192.png" with { type: "file" };
import listenIcon512Path from "./web/icons/listen-512.png" with { type: "file" };
import appleTouchIconPath from "./web/icons/apple-touch-icon.png" with { type: "file" };
import { createLogger, createWebAppPublicAsset, createWebAppServer, defineRoutes, errorResponse, getRequestBaseUrl, getRequestOriginInfo, jsonResponse, notFound, parseJson, readRuntimeConfig, successResponse, type ResourceRealtimeEvent, type RuntimeConfig, type WebAppServer, type WebAppWebSocketData } from "@pablozaiden/webapp/server";
import { browserPushEndpointRequestSchema, browserPushSubscribeRequestSchema, createSourceRequestSchema, listNotificationsQuerySchema, sourceMutationResponseSchema, type WebhookNotificationRequest, webhookNotificationRequestSchema } from "@listen/contracts";
import { WEBHOOK_JSON_BODY_MAX_BYTES } from "@listen/shared";
import { verifyWebhookToken } from "./core/webhook-tokens";
import { createNotificationFromWebhook, deleteNotification, deleteNotifications, getNotificationDetail, listNotifications, markNotificationRead, markNotificationUnread, markNotificationsRead } from "./core/notifications";
import { createSource, deleteSourceAndNotifications, getSourceForWebhook, listSources, markSourceUsed, rotateSourceToken } from "./core/sources";
import { getBrowserPushConfig, getBrowserPushSubscriptionStatus, subscribeBrowserPush, unsubscribeBrowserPush } from "./core/browser-push";
import { initializeDatabase } from "./persistence/database";
import { LISTEN_VERSION } from "./version";
import { createWebhookRateLimiter, type WebhookRateLimitDecision, type WebhookRateLimiter } from "./core/webhook-rate-limit";
import { parseQuery } from "./api/validation";
import { SERVICE_WORKER_ASSET } from "./web/service-worker-asset";
import { accountSessions, currentOwner, ownerSessionActive, type OwnerAccount } from "./core/account";
import { createAccountRoutes } from "./api/account";

type ListenRealtimeEvent = ResourceRealtimeEvent;

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

export function createRoutes(
  runtimeConfig: RuntimeConfig,
  webhookRateLimiter: WebhookRateLimiter,
  webhookCallerKeyResolver: WebhookCallerKeyResolver,
) {
  return defineRoutes<ListenRealtimeEvent, OwnerAccount>({
  "/api/sources": {
    auth: "required",
    requestSchema: createSourceRequestSchema,
    GET: (_req, ctx) => {
      const owner = ctx.requireIdentity();
      return jsonResponse({ sources: listSources(owner) });
    },
    async POST(req, ctx) {
      const owner = ctx.requireIdentity();
      const body = await parseJson(req, createSourceRequestSchema);
      const source = await createSource(body.name, getRequestBaseUrl(req, runtimeConfig), owner);
      ctx.realtime.publishEntityChanged("sources", source.source.id, { target: { userId: owner.id }, payload: source.source });
      return jsonResponse(sourceMutationResponseSchema.parse(source), { status: 201 });
    },
  },
  "/api/sources/:id/token/rotate": {
    auth: "required",
    responseSchema: sourceMutationResponseSchema,
    async POST(req, ctx) {
      const owner = ctx.requireIdentity();
      const source = await rotateSourceToken(ctx.params.id ?? "", getRequestBaseUrl(req, runtimeConfig), owner);
      if (!source) return notFound();
      ctx.realtime.publishEntityChanged("sources", source.source.id, { target: { userId: owner.id }, payload: source.source });
      return jsonResponse(sourceMutationResponseSchema.parse(source));
    },
  },
  "/api/sources/:id": {
    auth: "required",
    DELETE: (_req, ctx) => {
      const owner = ctx.requireIdentity();
      if (!deleteSourceAndNotifications(ctx.params.id ?? "", owner)) return notFound();
      ctx.realtime.publishDeleted("sources", ctx.params.id ?? "", { target: { userId: owner.id } });
      ctx.realtime.publishChanged("notifications", { target: { userId: owner.id } });
      return successResponse();
    },
  },
  "/api/notifications": {
    auth: "required",
    querySchema: listNotificationsQuerySchema,
    GET: (req, ctx) => {
      const owner = ctx.requireIdentity();
      const query = parseQuery(req, listNotificationsQuerySchema);
      if (query instanceof Response) return query;
      return jsonResponse(listNotifications({
        owner,
        ...query,
      }));
    },
    DELETE: (req, ctx) => {
      const owner = ctx.requireIdentity();
      const query = parseQuery(req, listNotificationsQuerySchema);
      if (query instanceof Response) return query;
      const deletedCount = deleteNotifications({
        owner,
        sourceId: query.sourceId,
        read: query.read,
      });
      ctx.realtime.publishChanged("notifications", { target: { userId: owner.id } });
      return jsonResponse({ deletedCount });
    },
  },
  "/api/notifications/read": {
    auth: "required",
    POST: (req, ctx) => {
      const owner = ctx.requireIdentity();
      const url = new URL(req.url);
      const updatedCount = markNotificationsRead(owner, url.searchParams.get("sourceId") || undefined);
      ctx.realtime.publishChanged("notifications", { target: { userId: owner.id } });
      return successResponse({ success: true, updatedCount });
    },
  },
  "/api/notifications/:id": {
    auth: "required",
    GET: (_req, ctx) => {
      const owner = ctx.requireIdentity();
      const notification = getNotificationDetail(ctx.params.id ?? "", owner);
      if (!notification) return notFound();
      ctx.realtime.publishEntityChanged("notifications", notification.id, { target: { userId: owner.id } });
      return jsonResponse({ notification });
    },
    DELETE: (_req, ctx) => {
      const owner = ctx.requireIdentity();
      if (!deleteNotification(ctx.params.id ?? "", owner)) return notFound();
      ctx.realtime.publishDeleted("notifications", ctx.params.id ?? "", { target: { userId: owner.id } });
      return successResponse();
    },
  },
  "/api/notifications/:id/read": {
    auth: "required",
    POST: (_req, ctx) => {
      const owner = ctx.requireIdentity();
      const notification = markNotificationRead(ctx.params.id ?? "", owner);
      if (!notification) return notFound();
      ctx.realtime.publishEntityChanged("notifications", notification.id, { target: { userId: owner.id } });
      return jsonResponse({ notification });
    },
  },
  "/api/notifications/:id/unread": {
    auth: "required",
    POST: (_req, ctx) => {
      const owner = ctx.requireIdentity();
      const notification = markNotificationUnread(ctx.params.id ?? "", owner);
      if (!notification) return notFound();
      ctx.realtime.publishEntityChanged("notifications", notification.id, { target: { userId: owner.id } });
      return jsonResponse({ notification });
    },
  },
  "/api/browser-push/config": {
    auth: "required",
    GET: (req, ctx) => {
      ctx.requireIdentity();
      return jsonResponse(getBrowserPushConfig(getRequestOriginInfo(req, runtimeConfig).origin));
    },
  },
  "/api/browser-push/subscriptions": {
    auth: "required",
    async POST(req, ctx) {
      const owner = ctx.requireIdentity();
      const body = await parseJson(req, browserPushSubscribeRequestSchema);
      return jsonResponse(subscribeBrowserPush(body.subscription, req, owner), { status: 201 });
    },
    async DELETE(req, ctx) {
      const owner = ctx.requireIdentity();
      const body = await parseJson(req, browserPushEndpointRequestSchema);
      return jsonResponse(unsubscribeBrowserPush(body.endpoint, owner));
    },
  },
  "/api/browser-push/subscriptions/lookup": {
    auth: "required",
    async POST(req, ctx) {
      const owner = ctx.requireIdentity();
      const body = await parseJson(req, browserPushEndpointRequestSchema);
      return jsonResponse(getBrowserPushSubscriptionStatus(body.endpoint, owner));
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
      const owner = currentOwner();
      if (!owner || owner.id !== source.userId) throw new Error("Webhook source does not belong to the owner");
      markSourceUsed(source.id, owner);
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
): WebAppServer<ListenRealtimeEvent> {
  const dataDir = runtimeConfig.dataDir;
  initializeDatabase(dataDir);
  const webhookRateLimiter = createWebhookRateLimiter();
  const authRateLimiter = createWebhookRateLimiter({ callerLimit: 30 });
  let listener: Server<WebAppWebSocketData> | undefined;
  const server = createWebAppServer<ListenRealtimeEvent, OwnerAccount>({
    appName: "Listen",
    envPrefix: "LISTEN",
    runtimeConfig,
    web: {
      icons: {
        favicon: { src: listenIconSvgPath, sizes: "any", type: "image/svg+xml" },
        appleTouch: { src: appleTouchIconPath, sizes: "180x180", type: "image/png" },
        manifest: [
          { src: listenIcon192Path, sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: listenIcon512Path, sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
    },
    version: LISTEN_VERSION,
    lifecycle: {
      afterStart(server) { listener = server; },
      afterStop() { listener = undefined; },
    },
    identity: {
      async authenticate(req) {
        const session = await accountSessions(req, runtimeConfig).authenticate(req);
        return session ? { identity: session.identity, credential: "ambient" } : undefined;
      },
    },
    realtime: {
      path: "/api/ws",
      async authenticate(req) {
        const authenticated = await accountSessions(req, runtimeConfig).authenticate(req);
        if (!authenticated) return undefined;
        const { identity: owner, session } = authenticated;
        return {
          data: { userId: owner.id },
          credential: "ambient" as const,
          options: {
            authorize: (publication) => ownerSessionActive(owner, session) && publication.target.userId === owner.id,
          },
        };
      },
    },
    routes: {
      ...createAccountRoutes(runtimeConfig, (req) => authRateLimiter.checkCaller(getWebhookCallerKey(req, listener)).allowed),
      ...createRoutes(runtimeConfig, webhookRateLimiter, getWebhookCallerKey),
    },
    publicRoutes: { [SERVICE_WORKER_ASSET.path]: createWebAppPublicAsset(SERVICE_WORKER_ASSET) },
  });
  return server;
}

export async function startServer(): Promise<Server<WebAppWebSocketData>> {
  const server = await getWebAppServer().start();
  return server;
}
