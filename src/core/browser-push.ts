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
import { createLogger } from "./logger";
import { getRequestOrigin } from "./request-origin";

const log = createLogger("browser-push");
const PUSH_TTL_SECONDS = 60 * 60;

type BrowserPushSender = (subscription: webPush.PushSubscription, payload: string, options: webPush.RequestOptions) => Promise<webPush.SendResult>;

const defaultBrowserPushSender: BrowserPushSender = (subscription, payload, options) => webPush.sendNotification(subscription, payload, options);
let browserPushSender: BrowserPushSender = defaultBrowserPushSender;

interface BrowserPushPayload {
  title: string;
  body: string;
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
  return generated;
}

function toVapidSubject(publicOrigin: string): string {
  try {
    return new URL(publicOrigin).protocol === "https:" ? publicOrigin : "mailto:listen@localhost";
  } catch {
    return "mailto:listen@localhost";
  }
}

export function getBrowserPushConfig(req: Request): BrowserPushConfigResponse {
  const keys = getOrCreateVapidKeys();
  webPush.setVapidDetails(toVapidSubject(getRequestOrigin(req).origin), keys.publicKey, keys.privateKey);
  return { publicKey: keys.publicKey };
}

function toPersistedSubscription(subscription: BrowserPushSubscription, req: Request): PersistedBrowserPushSubscription {
  const createdAt = nowIso();
  const userAgent = req.headers.get("user-agent")?.slice(0, BROWSER_PUSH_USER_AGENT_MAX_CHARS);
  return {
    id: crypto.randomUUID(),
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

export function subscribeBrowserPush(subscription: BrowserPushSubscription, req: Request): BrowserPushStatusResponse {
  upsertBrowserPushSubscription(toPersistedSubscription(subscription, req));
  return { subscribed: true };
}

export function getBrowserPushSubscriptionStatus(endpoint: string): BrowserPushStatusResponse {
  const subscription = getBrowserPushSubscriptionByEndpoint(endpoint);
  return { subscribed: Boolean(subscription && !subscription.disabledAt) };
}

export function unsubscribeBrowserPush(endpoint: string): BrowserPushStatusResponse {
  deleteBrowserPushSubscriptionByEndpoint(endpoint);
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

function toPushPayload(notification: NotificationListItem): BrowserPushPayload {
  const url = `/?notificationId=${encodeURIComponent(notification.id)}`;
  return {
    title: notification.title,
    body: notification.shortDescription,
    data: {
      notificationId: notification.id,
      url,
    },
    icon: "/icons/listen-192.png",
    badge: "/icons/listen-192.png",
    tag: notification.id,
  };
}

async function sendOneBrowserPush(subscription: PersistedBrowserPushSubscription, payload: BrowserPushPayload): Promise<void> {
  try {
    await browserPushSender(toWebPushSubscription(subscription), JSON.stringify(payload), { TTL: PUSH_TTL_SECONDS });
    markBrowserPushSubscriptionSucceeded(subscription.endpoint, nowIso());
  } catch (error) {
    if (isPermanentPushFailure(error)) {
      deleteBrowserPushSubscriptionByEndpoint(subscription.endpoint);
      log.info("Removed expired browser push subscription", { statusCode: getFailureStatusCode(error) });
      return;
    }
    const failedAt = new Date();
    markBrowserPushSubscriptionFailed(subscription.endpoint, failedAt.toISOString(), nextFailureAttempt(subscription.failureCount, failedAt));
    log.warn("Browser push delivery failed", { statusCode: getFailureStatusCode(error) });
  }
}

export async function sendBrowserPushNotification(notification: NotificationListItem, publicOrigin: string): Promise<void> {
  const subscriptions = listActiveBrowserPushSubscriptions(Date.now(), nowIso());
  if (subscriptions.length === 0) {
    return;
  }
  const keys = getOrCreateVapidKeys();
  webPush.setVapidDetails(toVapidSubject(publicOrigin), keys.publicKey, keys.privateKey);
  const payload = toPushPayload(notification);
  await Promise.all(subscriptions.map((subscription) => sendOneBrowserPush(subscription, payload)));
}

export function setBrowserPushSenderForTests(sender?: BrowserPushSender): void {
  browserPushSender = sender ?? defaultBrowserPushSender;
}
