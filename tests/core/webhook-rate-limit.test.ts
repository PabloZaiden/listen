import "./../setup";
import { describe, expect, test } from "bun:test";
import { createWebhookRateLimiter } from "../../src/core/webhook-rate-limit";

describe("webhook rate limiter", () => {
  test("isolates caller and source buckets", () => {
    const limiter = createWebhookRateLimiter({
      callerLimit: 1,
      sourceLimit: 1,
      emergencyGlobalLimit: 100,
    });

    expect(limiter.checkCaller("caller-a")).toEqual({ allowed: true });
    expect(limiter.checkCaller("caller-a").allowed).toBe(false);
    expect(limiter.checkCaller("caller-b")).toEqual({ allowed: true });

    expect(limiter.checkSource("source-a")).toEqual({ allowed: true });
    expect(limiter.checkSource("source-a").allowed).toBe(false);
    expect(limiter.checkSource("source-b")).toEqual({ allowed: true });
  });

  test("calculates retry-after from an injected clock", () => {
    let nowMs = 0;
    const limiter = createWebhookRateLimiter({
      windowMs: 10_000,
      callerLimit: 1,
      emergencyGlobalLimit: 100,
      now: () => nowMs,
    });

    expect(limiter.checkCaller("caller")).toEqual({ allowed: true });
    nowMs = 1_234;
    expect(limiter.checkCaller("caller")).toEqual({ allowed: false, retryAfterSeconds: 9 });
    nowMs = 9_999;
    expect(limiter.checkCaller("caller")).toEqual({ allowed: false, retryAfterSeconds: 1 });
    nowMs = 10_000;
    expect(limiter.checkCaller("caller")).toEqual({ allowed: true });
  });

  test("expires idle buckets and evicts the least recently used key at capacity", () => {
    let nowMs = 0;
    const limiter = createWebhookRateLimiter({
      callerLimit: 1,
      sourceLimit: 1,
      emergencyGlobalLimit: 100,
      bucketIdleTtlMs: 100,
      maxCallerBuckets: 2,
      maxSourceBuckets: 2,
      now: () => nowMs,
    });

    expect(limiter.checkCaller("caller-a")).toEqual({ allowed: true });
    expect(limiter.checkCaller("caller-b")).toEqual({ allowed: true });
    expect(limiter.checkCaller("caller-a").allowed).toBe(false);
    expect(limiter.checkCaller("caller-c")).toEqual({ allowed: true });
    expect(limiter.getBucketCounts()).toEqual({ callerBuckets: 2, sourceBuckets: 0 });
    expect(limiter.checkCaller("caller-b")).toEqual({ allowed: true });

    expect(limiter.checkSource("source-a")).toEqual({ allowed: true });
    expect(limiter.checkSource("source-b")).toEqual({ allowed: true });
    nowMs = 100;
    expect(limiter.getBucketCounts()).toEqual({ callerBuckets: 0, sourceBuckets: 0 });
    expect(limiter.checkSource("source-c")).toEqual({ allowed: true });
    expect(limiter.getBucketCounts()).toEqual({ callerBuckets: 0, sourceBuckets: 1 });
  });

  test("keeps the emergency global ceiling separate from caller buckets", () => {
    const limiter = createWebhookRateLimiter({
      callerLimit: 100,
      emergencyGlobalLimit: 1,
    });

    expect(limiter.checkCaller("caller-a")).toEqual({ allowed: true });
    expect(limiter.checkCaller("caller-b")).toEqual({ allowed: true });
    expect(limiter.checkEmergencyGlobal()).toEqual({ allowed: true });
    expect(limiter.checkEmergencyGlobal().allowed).toBe(false);
  });
});
