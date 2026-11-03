import "./../setup";
import { describe, expect, test } from "bun:test";
import {
  getBrowserPushSubscriptionStatus,
  sendBrowserPushNotification,
  setBrowserPushSenderForTests,
  subscribeBrowserPush,
  toVapidSubject,
} from "../../src/core/browser-push";
import { createOwner } from "../../src/persistence/account";

describe("browser push", () => {
  test("uses https origins as VAPID subjects", () => {
    expect(toVapidSubject("https://listen.example.test")).toBe("https://listen.example.test");
  });

  test("uses a valid mailto VAPID subject for local http origins", () => {
    expect(toVapidSubject("http://localhost:3000")).toBe("mailto:listen@example.com");
  });

  test("allows overriding the VAPID subject", () => {
    process.env["LISTEN_VAPID_SUBJECT"] = "mailto:dev@example.test";
    expect(toVapidSubject("http://localhost:3000")).toBe("mailto:dev@example.test");
    delete process.env["LISTEN_VAPID_SUBJECT"];
  });

  test("delivers compact owner push payloads, retires expired endpoints and backs off temporary failures", async () => {
    const owner = createOwner(crypto.randomUUID(), "push-owner");
    const endpoints = {
      active: "https://push.example.test/active",
      gone: "https://push.example.test/gone",
      temporary: "https://push.example.test/temporary",
    };
    for (const endpoint of Object.values(endpoints)) {
      subscribeBrowserPush({ endpoint, expirationTime: null, keys: { p256dh: "disposable", auth: "disposable" } }, new Request("https://listen.example.test"), owner);
    }
    const deliveries: { endpoint: string; payload: Record<string, unknown> }[] = [];
    setBrowserPushSenderForTests(async (subscription, payload) => {
      deliveries.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) as Record<string, unknown> });
      if (subscription.endpoint === endpoints.gone) throw Object.assign(new Error("Expired subscription"), { statusCode: 410 });
      if (subscription.endpoint === endpoints.temporary) throw Object.assign(new Error("Temporary failure"), { statusCode: 503 });
      return { statusCode: 201, body: "", headers: {} };
    });
    const notification = {
      id: crypto.randomUUID(), title: "Done", shortDescription: "Finished",
      sourceId: crypto.randomUUID(), source: "Build", createdAt: new Date().toISOString(),
    };
    await sendBrowserPushNotification(notification, 1, "https://listen.example.test", owner);
    expect(deliveries.map(delivery => delivery.endpoint).sort()).toEqual(Object.values(endpoints).sort());
    for (const delivery of deliveries) {
      expect(delivery.payload).toMatchObject({
        title: notification.title, body: notification.shortDescription, unreadCount: 1,
        data: { notificationId: notification.id, url: `/#/notification?id=${notification.id}` },
      });
      expect(delivery.payload["markdownContent"]).toBeUndefined();
    }
    expect(getBrowserPushSubscriptionStatus(endpoints.gone, owner).subscribed).toBe(false);
    expect(getBrowserPushSubscriptionStatus(endpoints.temporary, owner).subscribed).toBe(true);
    deliveries.length = 0;
    await sendBrowserPushNotification(notification, 1, "https://listen.example.test", owner);
    expect(deliveries.map(delivery => delivery.endpoint)).toEqual([endpoints.active]);
  });
});