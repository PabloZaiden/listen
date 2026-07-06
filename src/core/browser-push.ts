import webPush from "web-push";
import type { BrowserPushSubscription, BrowserPushConfigResponse, BrowserPushStatusResponse, NotificationListItem } from "@listen/contracts";
import {
  BROWSER_PUSH_FAILURE_BACKOFF_BASE_MS,
  BROWSER_PUSH_FAILURE_BACKOFF_MAX_MS,
  BROWSER_PUSH_USER_AGENT_MAX_CHARS,
} from "@listen/shared";
import {
  deleteBrowserPushSubscriptionByEndpoint,
  getBrowserPushSubscriptionByEndpoint,
  getPersistedVapidKeys,
  listActiveBrowserPushSubscriptions,
  markBrowserPushSubscriptionFailed,
  markBrowserPushSubscriptionSucceeded,
  setPersistedVapidKeys,
  upsertBrowserPushSubscription,
  type PersistedBrowserPushSubscription,
  type PersistedVapidKeys,
} from "../persistence/browser-push";
import { createLogger, errorLogFields } from "./logger";
import { getRequestOrigin } from "./request-origin";

const log = createLogger("browser-push");
const PUSH_TTL_SECONDS = 60 * 60;
const DEFAULT_VAPID_SUBJECT = "mailto:listen@example.com";

type BrowserPushSender = (subscription: webPush.PushSubscription, payload: string, options: webPush.RequestOptions) => Promise<webPush.SendResult>;

const defaultBrowserPushSender: BrowserPushSender = (subscription, payload, options) => webPush.sendNotification(subscription, payload, options);
let browserPushSender: BrowserPushSender = defaultBrowserPushSender;

interface BrowserPushPayload {
  title: string;
  body: string;
  unreadCount: number;
  data: {
    notificationId: string;
    url: string;
  };
  icon?: string;
  badge?: string;
  tag: string;
}

interface WebPushStatusError {
  statusCode?: number;
  body?: unknown;
}

function nowIso(): string {
  return new Date().toISOString();
}

function getOrCreateVapidKeys(): PersistedVapidKeys {
  const existing = getPersistedVapidKeys();
  if (existing) {
    return existing;
  }
  const generated = webPush.generateVAPIDKeys();
  setPersistedVapidKeys(generated);
  log.info("Generated browser push VAPID keys");
  return generated;
}

function endpointOrigin(endpoint: string): string | undefined {
  try {
    return new URL(endpoint).origin;
  } catch {
    return undefined;
  }
}

export function toVapidSubject(publicOrigin: string): string {
  const configuredSubject = process.env["LISTEN_VAPID_SUBJECT"]?.trim();
  if (configuredSubject) {
    return configuredSubject;
  }
  try {
    return new URL(publicOrigin).protocol === "https:" ? publicOrigin : DEFAULT_VAPID_SUBJECT;
  } catch {
    return DEFAULT_VAPID_SUBJECT;
  }
}

export function getBrowserPushConfig(req: Request): BrowserPushConfigResponse {
  const keys = getOrCreateVapidKeys();
  const requestOrigin = getRequestOrigin(req).origin;
  const vapidSubject = toVapidSubject(requestOrigin);
  webPush.setVapidDetails(vapidSubject, keys.publicKey, keys.privateKey);
  log.trace("Browser push config requested", { requestOrigin, vapidSubject });
  return { publicKey: keys.publicKey };
}

function toPersistedSubscription(subscription: BrowserPushSubscription, req: Request, userId: string): PersistedBrowserPushSubscription {
  const createdAt = nowIso();
  const userAgent = req.headers.get("user-agent")?.slice(0, BROWSER_PUSH_USER_AGENT_MAX_CHARS);
  return {
    id: crypto.randomUUID(),
    userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    expirationTime: subscription.expirationTime ?? undefined,
    userAgent,
    createdAt,
    updatedAt: createdAt,
    failureCount: 0,
  };
}

export function subscribeBrowserPush(subscription: BrowserPushSubscription, req: Request, userId = ""): BrowserPushStatusResponse {
  const persisted = upsertBrowserPushSubscription(toPersistedSubscription(subscription, req, userId));
  log.info("Browser push subscription saved", {
    subscriptionId: persisted.id,
    userId,
    endpointOrigin: endpointOrigin(persisted.endpoint),
    userAgent: persisted.userAgent,
  });
  return { subscribed: true };
}

export function getBrowserPushSubscriptionStatus(endpoint: string, userId?: string): BrowserPushStatusResponse {
  const subscription = getBrowserPushSubscriptionByEndpoint(endpoint, userId);
  log.trace("Browser push subscription status checked", {
    subscriptionId: subscription?.id,
    userId,
    endpointOrigin: endpointOrigin(endpoint),
    subscribed: Boolean(subscription && !subscription.disabledAt),
    disabled: Boolean(subscription?.disabledAt),
  });
  return { subscribed: Boolean(subscription && !subscription.disabledAt) };
}

export function unsubscribeBrowserPush(endpoint: string, userId?: string): BrowserPushStatusResponse {
  const deleted = deleteBrowserPushSubscriptionByEndpoint(endpoint, userId);
  log.info("Browser push subscription delete requested", { endpointOrigin: endpointOrigin(endpoint), userId, deleted });
  return { subscribed: false };
}

function toWebPushSubscription(subscription: PersistedBrowserPushSubscription): webPush.PushSubscription {
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ?? null,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  };
}

function getFailureStatusCode(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "statusCode" in error
    ? (error as WebPushStatusError).statusCode
    : undefined;
}

function getFailureBody(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("body" in error)) {
    return undefined;
  }
  const body = (error as WebPushStatusError).body;
  return typeof body === "string" ? body.slice(0, 500) : undefined;
}

function isPermanentPushFailure(error: unknown): boolean {
  const statusCode = getFailureStatusCode(error);
  return statusCode === 404 || statusCode === 410;
}

function nextFailureAttempt(failureCount: number, failedAt: Date): string {
  const nextFailureCount = failureCount + 1;
  const delayMs = Math.min(
    BROWSER_PUSH_FAILURE_BACKOFF_BASE_MS * (2 ** Math.min(nextFailureCount - 1, 10)),
    BROWSER_PUSH_FAILURE_BACKOFF_MAX_MS,
  );
  return new Date(failedAt.getTime() + delayMs).toISOString();
}

function toPushPayload(notification: NotificationListItem, unreadCount: number): BrowserPushPayload {
  const url = `/#/notification?id=${encodeURIComponent(notification.id)}`;
  return {
    title: notification.title,
    body: notification.shortDescription,
    unreadCount,
    data: {
      notificationId: notification.id,
      url,
    },
    icon: "/webapp-icon.svg",
    badge: "/webapp-icon.svg",
    tag: notification.id,
  };
}

async function sendOneBrowserPush(subscription: PersistedBrowserPushSubscription, payload: BrowserPushPayload): Promise<void> {
  try {
    await browserPushSender(toWebPushSubscription(subscription), JSON.stringify(payload), { TTL: PUSH_TTL_SECONDS });
    markBrowserPushSubscriptionSucceeded(subscription.endpoint, nowIso());
    log.info("Browser push delivery succeeded", {
      subscriptionId: subscription.id,
      endpointOrigin: endpointOrigin(subscription.endpoint),
      notificationId: payload.data.notificationId,
    });
  } catch (error) {
    if (isPermanentPushFailure(error)) {
      deleteBrowserPushSubscriptionByEndpoint(subscription.endpoint, subscription.userId);
      log.info("Removed expired browser push subscription", {
        subscriptionId: subscription.id,
        endpointOrigin: endpointOrigin(subscription.endpoint),
        notificationId: payload.data.notificationId,
        statusCode: getFailureStatusCode(error),
        body: getFailureBody(error),
      });
      return;
    }
    const failedAt = new Date();
    const nextAttemptAt = nextFailureAttempt(subscription.failureCount, failedAt);
    markBrowserPushSubscriptionFailed(subscription.endpoint, failedAt.toISOString(), nextAttemptAt);
    log.warn("Browser push delivery failed", {
      subscriptionId: subscription.id,
      endpointOrigin: endpointOrigin(subscription.endpoint),
      notificationId: payload.data.notificationId,
      failureCount: subscription.failureCount + 1,
      nextAttemptAt,
      statusCode: getFailureStatusCode(error),
      body: getFailureBody(error),
      ...errorLogFields(error),
    });
  }
}

export async function sendBrowserPushNotification(notification: NotificationListItem, unreadCount: number, publicOrigin: string, userId?: string): Promise<void> {
  const subscriptions = listActiveBrowserPushSubscriptions(Date.now(), nowIso(), userId);
  if (subscriptions.length === 0) {
    log.trace("Browser push fanout skipped because no active subscriptions are available", { notificationId: notification.id });
    return;
  }
  const keys = getOrCreateVapidKeys();
  const vapidSubject = toVapidSubject(publicOrigin);
  webPush.setVapidDetails(vapidSubject, keys.publicKey, keys.privateKey);
  const payload = toPushPayload(notification, unreadCount);
  log.info("Browser push fanout started", {
    notificationId: notification.id,
    subscriptionCount: subscriptions.length,
    userId,
    publicOrigin,
    vapidSubject,
  });
  await Promise.all(subscriptions.map((subscription) => sendOneBrowserPush(subscription, payload)));
}

export function setBrowserPushSenderForTests(sender?: BrowserPushSender): void {
  browserPushSender = sender ?? defaultBrowserPushSender;
}
