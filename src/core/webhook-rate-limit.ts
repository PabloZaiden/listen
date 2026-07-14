import {
  WEBHOOK_CALLER_RATE_LIMIT_MAX_REQUESTS,
  WEBHOOK_EMERGENCY_GLOBAL_RATE_LIMIT_MAX_REQUESTS,
  WEBHOOK_RATE_LIMIT_BUCKET_IDLE_TTL_MS,
  WEBHOOK_RATE_LIMIT_MAX_CALLER_BUCKETS,
  WEBHOOK_RATE_LIMIT_MAX_SOURCE_BUCKETS,
  WEBHOOK_RATE_LIMIT_WINDOW_MS,
  WEBHOOK_SOURCE_RATE_LIMIT_MAX_REQUESTS,
} from "@listen/shared";

export type WebhookRateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export interface WebhookRateLimitOptions {
  windowMs?: number;
  callerLimit?: number;
  sourceLimit?: number;
  emergencyGlobalLimit?: number;
  bucketIdleTtlMs?: number;
  maxCallerBuckets?: number;
  maxSourceBuckets?: number;
  now?: () => number;
}

export interface WebhookRateLimiter {
  checkCaller(callerKey: string): WebhookRateLimitDecision;
  checkSource(sourceId: string): WebhookRateLimitDecision;
  checkEmergencyGlobal(): WebhookRateLimitDecision;
  getBucketCounts(): {
    callerBuckets: number;
    sourceBuckets: number;
  };
}

interface RateLimitBucket {
  count: number;
  windowStartedAt: number;
  lastSeenAt: number;
}

interface ResolvedWebhookRateLimitOptions {
  windowMs: number;
  callerLimit: number;
  sourceLimit: number;
  emergencyGlobalLimit: number;
  bucketIdleTtlMs: number;
  maxCallerBuckets: number;
  maxSourceBuckets: number;
  now: () => number;
}

const defaultOptions: ResolvedWebhookRateLimitOptions = {
  windowMs: WEBHOOK_RATE_LIMIT_WINDOW_MS,
  callerLimit: WEBHOOK_CALLER_RATE_LIMIT_MAX_REQUESTS,
  sourceLimit: WEBHOOK_SOURCE_RATE_LIMIT_MAX_REQUESTS,
  emergencyGlobalLimit: WEBHOOK_EMERGENCY_GLOBAL_RATE_LIMIT_MAX_REQUESTS,
  bucketIdleTtlMs: WEBHOOK_RATE_LIMIT_BUCKET_IDLE_TTL_MS,
  maxCallerBuckets: WEBHOOK_RATE_LIMIT_MAX_CALLER_BUCKETS,
  maxSourceBuckets: WEBHOOK_RATE_LIMIT_MAX_SOURCE_BUCKETS,
  now: Date.now,
};

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(0, Math.floor(value));
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(1, Math.floor(value));
}

function normalizeKey(value: string): string {
  return value.trim() || "unknown";
}

function checkBucket(bucket: RateLimitBucket | undefined, limit: number, nowMs: number, windowMs: number): {
  bucket: RateLimitBucket;
  decision: WebhookRateLimitDecision;
} {
  const activeBucket = bucket && nowMs - bucket.windowStartedAt < windowMs
    ? bucket
    : { count: 0, windowStartedAt: nowMs, lastSeenAt: nowMs };
  activeBucket.lastSeenAt = nowMs;

  if (activeBucket.count >= limit) {
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

function removeExpiredBuckets(buckets: Map<string, RateLimitBucket>, nowMs: number, idleTtlMs: number): void {
  for (const [key, bucket] of buckets) {
    if (nowMs - bucket.lastSeenAt >= idleTtlMs) {
      buckets.delete(key);
    }
  }
}

function touchBucket(buckets: Map<string, RateLimitBucket>, key: string, bucket: RateLimitBucket): void {
  buckets.delete(key);
  buckets.set(key, bucket);
}

function evictOldestBucket(buckets: Map<string, RateLimitBucket>, maxBuckets: number): void {
  while (buckets.size >= maxBuckets) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    buckets.delete(oldestKey);
  }
}

export function createWebhookRateLimiter(overrides: WebhookRateLimitOptions = {}): WebhookRateLimiter {
  const options: ResolvedWebhookRateLimitOptions = {
    windowMs: positiveInteger(overrides.windowMs, defaultOptions.windowMs),
    callerLimit: nonNegativeInteger(overrides.callerLimit, defaultOptions.callerLimit),
    sourceLimit: nonNegativeInteger(overrides.sourceLimit, defaultOptions.sourceLimit),
    emergencyGlobalLimit: nonNegativeInteger(overrides.emergencyGlobalLimit, defaultOptions.emergencyGlobalLimit),
    bucketIdleTtlMs: positiveInteger(overrides.bucketIdleTtlMs, defaultOptions.bucketIdleTtlMs),
    maxCallerBuckets: positiveInteger(overrides.maxCallerBuckets, defaultOptions.maxCallerBuckets),
    maxSourceBuckets: positiveInteger(overrides.maxSourceBuckets, defaultOptions.maxSourceBuckets),
    now: overrides.now ?? defaultOptions.now,
  };
  const callerBuckets = new Map<string, RateLimitBucket>();
  const sourceBuckets = new Map<string, RateLimitBucket>();
  let emergencyGlobalBucket: RateLimitBucket | undefined;

  function now(): number {
    return options.now();
  }

  function checkKeyedBucket(
    buckets: Map<string, RateLimitBucket>,
    key: string,
    limit: number,
    maxBuckets: number,
  ): WebhookRateLimitDecision {
    const nowMs = now();
    removeExpiredBuckets(buckets, nowMs, options.bucketIdleTtlMs);
    const normalizedKey = normalizeKey(key);
    const existing = buckets.get(normalizedKey);
    if (existing) {
      const result = checkBucket(existing, limit, nowMs, options.windowMs);
      touchBucket(buckets, normalizedKey, result.bucket);
      return result.decision;
    }

    evictOldestBucket(buckets, maxBuckets);
    const result = checkBucket(undefined, limit, nowMs, options.windowMs);
    buckets.set(normalizedKey, result.bucket);
    return result.decision;
  }

  return {
    checkCaller(callerKey) {
      return checkKeyedBucket(callerBuckets, callerKey, options.callerLimit, options.maxCallerBuckets);
    },
    checkSource(sourceId) {
      return checkKeyedBucket(sourceBuckets, sourceId, options.sourceLimit, options.maxSourceBuckets);
    },
    checkEmergencyGlobal() {
      const result = checkBucket(emergencyGlobalBucket, options.emergencyGlobalLimit, now(), options.windowMs);
      emergencyGlobalBucket = result.bucket;
      return result.decision;
    },
    getBucketCounts() {
      const nowMs = now();
      removeExpiredBuckets(callerBuckets, nowMs, options.bucketIdleTtlMs);
      removeExpiredBuckets(sourceBuckets, nowMs, options.bucketIdleTtlMs);
      return {
        callerBuckets: callerBuckets.size,
        sourceBuckets: sourceBuckets.size,
      };
    },
  };
}
