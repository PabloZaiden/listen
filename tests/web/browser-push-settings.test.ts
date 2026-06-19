import { describe, expect, test } from "bun:test";
import { applicationServerKeyMatches, base64UrlToUint8Array } from "../../src/web/browserPushSettings";

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
});