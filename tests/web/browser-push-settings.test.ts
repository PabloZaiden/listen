import { describe, expect, test } from "bun:test";
import { applicationServerKeyMatches, base64UrlToUint8Array, browserPushErrorSummary } from "../../src/web/browserPushSettings";

function pushSubscriptionWithKey(applicationServerKey: Uint8Array): PushSubscription {
  return {
    options: {
      applicationServerKey: applicationServerKey.buffer.slice(
        applicationServerKey.byteOffset,
        applicationServerKey.byteOffset + applicationServerKey.byteLength,
      ),
    },
  } as PushSubscription;
}

describe("browser push settings", () => {
  test("decodes VAPID public keys from base64url", () => {
    expect([...base64UrlToUint8Array("AQIDBA")]).toEqual([1, 2, 3, 4]);
  });

  test("matches subscriptions against the current application server key", () => {
    const currentKey = new Uint8Array([1, 2, 3]);

    expect(applicationServerKeyMatches(pushSubscriptionWithKey(currentKey), currentKey)).toBe(true);
    expect(applicationServerKeyMatches(pushSubscriptionWithKey(new Uint8Array([1, 2, 4])), currentKey)).toBe(false);
  });

  test("summarizes long browser push setup errors", () => {
    expect(browserPushErrorSummary("Failed to register a ServiceWorker for scope ('http://localhost:3000/') with script ('http://localhost:3000/service-worker'): ServiceWorker script evaluation failed")).toBe("Browser notifications could not start the service worker.");
    expect(browserPushErrorSummary("Permission prompt failed")).toBe("Browser notifications could not be enabled.");
  });
});