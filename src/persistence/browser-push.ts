import { getDatabase } from "./database";
import { getPreference, setPreference } from "./preferences";

const VAPID_PUBLIC_KEY_PREFERENCE = "browserPush.vapidPublicKey";
const VAPID_PRIVATE_KEY_PREFERENCE = "browserPush.vapidPrivateKey";

export interface PersistedVapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface PersistedBrowserPushSubscription {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime?: number;
  userAgent?: string;
  createdAt: string;
  updatedAt: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  failureCount: number;
  nextAttemptAt?: string;
  disabledAt?: string;
}

interface BrowserPushSubscriptionRow {
  id: string;
  user_id: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  expiration_time: number | null;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  failure_count: number;
  next_attempt_at: string | null;
  disabled_at: string | null;
}

function mapSubscription(row: BrowserPushSubscriptionRow): PersistedBrowserPushSubscription {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    expirationTime: row.expiration_time ?? undefined,
    userAgent: row.user_agent ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSuccessAt: row.last_success_at ?? undefined,
    lastFailureAt: row.last_failure_at ?? undefined,
    failureCount: row.failure_count,
    nextAttemptAt: row.next_attempt_at ?? undefined,
    disabledAt: row.disabled_at ?? undefined,
  };
}

export function getPersistedVapidKeys(): PersistedVapidKeys | undefined {
  const publicKey = getPreference(VAPID_PUBLIC_KEY_PREFERENCE);
  const privateKey = getPreference(VAPID_PRIVATE_KEY_PREFERENCE);
  return publicKey && privateKey ? { publicKey, privateKey } : undefined;
}

export function setPersistedVapidKeys(keys: PersistedVapidKeys): void {
  setPreference(VAPID_PUBLIC_KEY_PREFERENCE, keys.publicKey);
  setPreference(VAPID_PRIVATE_KEY_PREFERENCE, keys.privateKey);
}

export function getBrowserPushSubscriptionByEndpoint(endpoint: string, userId?: string): PersistedBrowserPushSubscription | undefined {
  const row = userId
    ? getDatabase().query("SELECT * FROM browser_push_subscriptions WHERE endpoint = $endpoint AND user_id = $userId").get({ endpoint, userId }) as BrowserPushSubscriptionRow | null
    : getDatabase().query("SELECT * FROM browser_push_subscriptions WHERE endpoint = $endpoint").get({ endpoint }) as BrowserPushSubscriptionRow | null;
  return row ? mapSubscription(row) : undefined;
}

export function upsertBrowserPushSubscription(subscription: PersistedBrowserPushSubscription): PersistedBrowserPushSubscription {
  getDatabase().query(`
    INSERT INTO browser_push_subscriptions (
      id, user_id, endpoint, p256dh, auth, expiration_time, user_agent, created_at, updated_at,
      last_success_at, last_failure_at, failure_count, next_attempt_at, disabled_at
    )
    VALUES (
      $id, $userId, $endpoint, $p256dh, $auth, $expirationTime, $userAgent, $createdAt, $updatedAt,
      $lastSuccessAt, $lastFailureAt, $failureCount, $nextAttemptAt, $disabledAt
    )
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = $userId,
      p256dh = $p256dh,
      auth = $auth,
      expiration_time = $expirationTime,
      user_agent = $userAgent,
      updated_at = $updatedAt,
      failure_count = 0,
      next_attempt_at = NULL,
      disabled_at = NULL
  `).run({
    id: subscription.id,
    userId: subscription.userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.p256dh,
    auth: subscription.auth,
    expirationTime: subscription.expirationTime ?? null,
    userAgent: subscription.userAgent ?? null,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
    lastSuccessAt: subscription.lastSuccessAt ?? null,
    lastFailureAt: subscription.lastFailureAt ?? null,
    failureCount: subscription.failureCount,
    nextAttemptAt: subscription.nextAttemptAt ?? null,
    disabledAt: subscription.disabledAt ?? null,
  });
  return getBrowserPushSubscriptionByEndpoint(subscription.endpoint, subscription.userId) ?? subscription;
}

export function listActiveBrowserPushSubscriptions(nowMs: number, nowIso: string, userId?: string): PersistedBrowserPushSubscription[] {
  const rows = getDatabase().query(`
    SELECT * FROM browser_push_subscriptions
    WHERE disabled_at IS NULL
      AND ($userId IS NULL OR user_id = $userId)
      AND (expiration_time IS NULL OR expiration_time > $nowMs)
      AND (next_attempt_at IS NULL OR next_attempt_at <= $nowIso)
    ORDER BY created_at ASC, id ASC
  `).all({ nowMs, nowIso, userId: userId ?? null }) as BrowserPushSubscriptionRow[];
  return rows.map(mapSubscription);
}

export function markBrowserPushSubscriptionSucceeded(endpoint: string, at: string): void {
  getDatabase().query(`
    UPDATE browser_push_subscriptions
    SET
      last_success_at = $at,
      last_failure_at = NULL,
      failure_count = 0,
      next_attempt_at = NULL,
      updated_at = $at
    WHERE endpoint = $endpoint
  `).run({ endpoint, at });
}

export function markBrowserPushSubscriptionFailed(endpoint: string, at: string, nextAttemptAt: string): void {
  getDatabase().query(`
    UPDATE browser_push_subscriptions
    SET
      last_failure_at = $at,
      failure_count = failure_count + 1,
      next_attempt_at = $nextAttemptAt,
      updated_at = $at
    WHERE endpoint = $endpoint
  `).run({ endpoint, at, nextAttemptAt });
}

export function deleteBrowserPushSubscriptionByEndpoint(endpoint: string, userId?: string): boolean {
  const result = getDatabase().query("DELETE FROM browser_push_subscriptions WHERE endpoint = $endpoint AND ($userId IS NULL OR user_id = $userId)").run({ endpoint, userId: userId ?? null });
  return result.changes > 0;
}
