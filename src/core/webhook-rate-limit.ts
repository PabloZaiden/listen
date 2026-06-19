import {
  WEBHOOK_GLOBAL_RATE_LIMIT_MAX_REQUESTS,
  WEBHOOK_RATE_LIMIT_WINDOW_MS,
  WEBHOOK_SOURCE_RATE_LIMIT_MAX_REQUESTS,
} from "@listen/shared";

export type WebhookRateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

interface RateLimitBucket {
  count: number;
  windowStartedAt: number;
}

interface WebhookRateLimitOptions {
  windowMs: number;
  globalLimit: number;
  sourceLimit: number;
}

const defaultOptions: WebhookRateLimitOptions = {
  windowMs: WEBHOOK_RATE_LIMIT_WINDOW_MS,
  globalLimit: WEBHOOK_GLOBAL_RATE_LIMIT_MAX_REQUESTS,
  sourceLimit: WEBHOOK_SOURCE_RATE_LIMIT_MAX_REQUESTS,
};

let options = defaultOptions;
let globalBucket: RateLimitBucket | undefined;
const sourceBuckets = new Map<string, RateLimitBucket>();

function checkBucket(bucket: RateLimitBucket | undefined, limit: number, nowMs: number): {
  bucket: RateLimitBucket;
  decision: WebhookRateLimitDecision;
} {
  const windowMs = Math.max(1, options.windowMs);
  const maxRequests = Math.max(0, Math.floor(limit));
  const activeBucket = bucket && nowMs - bucket.windowStartedAt < windowMs
    ? bucket
    : { count: 0, windowStartedAt: nowMs };

  if (activeBucket.count >= maxRequests) {
    return {
      bucket: activeBucket,
      decision: {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((activeBucket.windowStartedAt + windowMs - nowMs) / 1_000)),
      },
    };
  }

  activeBucket.count += 1;
  return { bucket: activeBucket, decision: { allowed: true } };
}

export function checkGlobalWebhookRateLimit(nowMs = Date.now()): WebhookRateLimitDecision {
  const result = checkBucket(globalBucket, options.globalLimit, nowMs);
  globalBucket = result.bucket;
  return result.decision;
}

export function checkSourceWebhookRateLimit(sourceId: string, nowMs = Date.now()): WebhookRateLimitDecision {
  const result = checkBucket(sourceBuckets.get(sourceId), options.sourceLimit, nowMs);
  sourceBuckets.set(sourceId, result.bucket);
  return result.decision;
}

export function resetWebhookRateLimitForTests(): void {
  options = defaultOptions;
  globalBucket = undefined;
  sourceBuckets.clear();
}

export function setWebhookRateLimitOptionsForTests(overrides: Partial<WebhookRateLimitOptions>): void {
  options = { ...defaultOptions, ...overrides };
  globalBucket = undefined;
  sourceBuckets.clear();
}
