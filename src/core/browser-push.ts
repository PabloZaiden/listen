import webPush from "web-push";
import type { BrowserPushConfigResponse, BrowserPushStatusResponse, BrowserPushSubscription, BrowserPushSubscriptionResponse, NotificationListItem } from "@listen/contracts";
import { createLogger } from "@pablozaiden/webapp/server";
import {
  BROWSER_PUSH_FAILURE_BACKOFF_BASE_MS,
  BROWSER_PUSH_FAILURE_BACKOFF_MAX_MS,
  BROWSER_PUSH_USER_AGENT_MAX_CHARS,
  requireUserId,
} from "@listen/shared";
import {
  claimBrowserPushSubscription,
  deleteBrowserPushSubscriptionByEndpoint,
  getBrowserPushSubscriptionByEndpoint,
  getPersistedVapidKeys,
  listBrowserPushSubscriptionsForDelivery,
  markBrowserPushSubscriptionFailed,
  markBrowserPushSubscriptionSucceeded,
  setPersistedVapidKeys,
  type PersistedBrowserPushSubscription,
  type PersistedVapidKeys,
} from "../persistence/browser-push";
import { errorLogFields } from "./log-fields";

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

export function getBrowserPushConfig(publicOrigin: string): BrowserPushConfigResponse {
  const keys = getOrCreateVapidKeys();
  const vapidSubject = toVapidSubject(publicOrigin);
  webPush.setVapidDetails(vapidSubject, keys.publicKey, keys.privateKey);
  log.trace("Browser push config requested", { publicOrigin, vapidSubject });
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

export function subscribeBrowserPush(subscription: BrowserPushSubscription, req: Request, userId: string): BrowserPushSubscriptionResponse {
  const ownerId = requireUserId(userId);
  const claim = claimBrowserPushSubscription(toPersistedSubscription(subscription, req, ownerId));
  log.info("Browser push subscription saved", {
    subscriptionId: claim.subscription.id,
    userId: ownerId,
    outcome: claim.outcome,
    userAgent: claim.subscription.userAgent,
  });
  if (claim.outcome === "transferred") {
    log.info("Browser push subscription ownership transferred", {
      subscriptionId: claim.subscription.id,
      userId: ownerId,
      outcome: claim.outcome,
    });
  }
  return { subscribed: true, outcome: claim.outcome };
}

export function getBrowserPushSubscriptionStatus(endpoint: string, userId: string): BrowserPushStatusResponse {
  const ownerId = requireUserId(userId);
  const subscription = getBrowserPushSubscriptionByEndpoint(endpoint, ownerId);
  log.trace("Browser push subscription status checked", {
    subscriptionId: subscription?.id,
    userId: ownerId,
    subscribed: Boolean(subscription),
  });
  return { subscribed: Boolean(subscription) };
}

export function unsubscribeBrowserPush(endpoint: string, userId: string): BrowserPushStatusResponse {
  const ownerId = requireUserId(userId);
  const deleted = deleteBrowserPushSubscriptionByEndpoint(endpoint, ownerId);
  log.info("Browser push subscription delete requested", { userId: ownerId, deleted });
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

const LISTEN_PUSH_ICON_PATH = "/webapp-favicon.svg";

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
    icon: LISTEN_PUSH_ICON_PATH,
    badge: LISTEN_PUSH_ICON_PATH,
    tag: notification.id,
  };
}

async function sendOneBrowserPush(subscription: PersistedBrowserPushSubscription, payload: BrowserPushPayload): Promise<void> {
  try {
    await browserPushSender(toWebPushSubscription(subscription), JSON.stringify(payload), { TTL: PUSH_TTL_SECONDS });
    markBrowserPushSubscriptionSucceeded(subscription.endpoint, subscription.userId, nowIso());
    log.info("Browser push delivery succeeded", {
      subscriptionId: subscription.id,
      notificationId: payload.data.notificationId,
    });
  } catch (error) {
    if (isPermanentPushFailure(error)) {
      deleteBrowserPushSubscriptionByEndpoint(subscription.endpoint, subscription.userId);
      log.info("Removed expired browser push subscription", {
        subscriptionId: subscription.id,
        notificationId: payload.data.notificationId,
        statusCode: getFailureStatusCode(error),
        body: getFailureBody(error),
      });
      return;
    }
    const failedAt = new Date();
    const nextAttemptAt = nextFailureAttempt(subscription.failureCount, failedAt);
    markBrowserPushSubscriptionFailed(subscription.endpoint, subscription.userId, failedAt.toISOString(), nextAttemptAt);
    log.warn("Browser push delivery failed", {
      subscriptionId: subscription.id,
      notificationId: payload.data.notificationId,
      failureCount: subscription.failureCount + 1,
      nextAttemptAt,
      statusCode: getFailureStatusCode(error),
      body: getFailureBody(error),
      ...errorLogFields(error),
    });
  }
}

export async function sendBrowserPushNotification(notification: NotificationListItem, unreadCount: number, publicOrigin: string, userId: string): Promise<void> {
  const ownerId = requireUserId(userId);
  const subscriptions = listBrowserPushSubscriptionsForDelivery(Date.now(), nowIso(), ownerId);
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
    userId: ownerId,
    publicOrigin,
    vapidSubject,
  });
  await Promise.all(subscriptions.map((subscription) => sendOneBrowserPush(subscription, payload)));
}

export function setBrowserPushSenderForTests(sender?: BrowserPushSender): void {
  browserPushSender = sender ?? defaultBrowserPushSender;
}
