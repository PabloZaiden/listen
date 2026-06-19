import "./../setup";
import { describe, expect, test } from "bun:test";
import { createFetchHandler } from "../../src/server";
import { readServerConfig, type ServerConfig } from "../../src/core/server-config";
import { handleServerControl, scheduleServerShutdown } from "../../src/api/server-control";
import { setBrowserPushSenderForTests } from "../../src/core/browser-push";
import { getLogLevel } from "../../src/core/logger";
import { getBrowserPushSubscriptionByEndpoint } from "../../src/persistence/browser-push";

async function request(path: string, init?: RequestInit, config?: Partial<ServerConfig>): Promise<Response> {
  const handler = createFetchHandler({ ...readServerConfig(), passkeyDisabled: true, sameOriginCheckDisabled: true, ...config });
  const response = await handler(new Request(`http://localhost${path}`, init));
  if (!response) {
    throw new Error("Request did not return a response");
  }
  return response;
}

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function createSource(): Promise<{ source: { id: string; name: string }; webhookUrl: string }> {
  const response = await request("/api/sources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Agent" }),
  });
  expect(response.status).toBe(201);
  return json(response);
}

async function webhook(webhookUrl: string, init: RequestInit): Promise<Response> {
  const url = new URL(webhookUrl);
  return request(url.pathname, init);
}

function browserPushSubscription(endpoint: string): unknown {
  return {
    endpoint,
    expirationTime: null,
    keys: {
      p256dh: "p256dh-key",
      auth: "auth-key",
    },
  };
}

async function waitForExpectation(assertion: () => void, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (lastError) {
    throw lastError;
  }
}

describe("API", () => {
  test("health returns ok", async () => {
    const response = await request("/api/health");
    expect(response.status).toBe(200);
    expect(await json<{ ok: boolean }>(response)).toEqual({ ok: true });
  });

  test("protected routes reject when passkey is required and no passkey is configured", async () => {
    const response = await request("/api/sources", undefined, { passkeyDisabled: false });
    expect(response.status).toBe(401);
    expect(response.headers.get("x-passkey-auth-required")).toBe("true");
    expect(await json(response)).toMatchObject({ error: "passkey_setup_required" });
  });

  test("server kill route rejects when passkey is required and no passkey is configured", async () => {
    const response = await request("/api/server/kill", { method: "POST" }, { passkeyDisabled: false });
    expect(response.status).toBe(401);
    expect(response.headers.get("x-passkey-auth-required")).toBe("true");
    expect(await json(response)).toMatchObject({ error: "passkey_setup_required" });
  });

  test("server kill route returns success before scheduling shutdown", async () => {
    let shutdownRequested = false;
    const response = handleServerControl(new Request("http://localhost/api/server/kill", { method: "POST" }), () => {
      shutdownRequested = true;
    });

    expect(response?.status).toBe(200);
    if (!response) {
      throw new Error("Server kill route did not return a response");
    }
    expect(await json<{ success: boolean; message: string }>(response)).toEqual({
      success: true,
      message: "Server is shutting down. The connection will be lost.",
    });
    expect(shutdownRequested).toBe(true);
  });

  test("server kill route rejects unsupported methods", async () => {
    let shutdownRequested = false;
    const response = handleServerControl(new Request("http://localhost/api/server/kill"), () => {
      shutdownRequested = true;
    });

    expect(response?.status).toBe(405);
    if (!response) {
      throw new Error("Server kill route did not return a response");
    }
    expect(await json<{ error: string }>(response)).toMatchObject({ error: "method_not_allowed" });
    expect(shutdownRequested).toBe(false);
  });

  test("server shutdown scheduler delays intentional process exit", () => {
    let scheduledDelay: number | undefined;
    let scheduledCallback: (() => void) | undefined;
    scheduleServerShutdown((callback, delayMs) => {
      scheduledCallback = callback;
      scheduledDelay = delayMs;
    });

    expect(scheduledDelay).toBe(100);
    expect(scheduledCallback).toBeFunction();
  });

  test("passkey status reports setup state", async () => {
    const response = await request("/api/passkey-auth/status", undefined, { passkeyDisabled: false });
    expect(await json(response)).toMatchObject({
      passkeyConfigured: false,
      passkeyDisabled: false,
      passkeyRequired: true,
      authenticated: false,
    });
  });

  test("log level preference can be changed at runtime", async () => {
    const initial = await json<{ level: string; defaultLevel: string; availableLevels: string[]; isFromEnv: boolean }>(await request("/api/preferences/log-level"));
    expect(initial.level).toBe("info");
    expect(initial.defaultLevel).toBe("info");
    expect(initial.availableLevels).toContain("trace");
    expect(initial.isFromEnv).toBe(false);

    const update = await request("/api/preferences/log-level", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level: "trace" }),
    });
    expect(update.status).toBe(200);
    expect(await json<{ level: string }>(update)).toMatchObject({ level: "trace" });
    expect(getLogLevel()).toBe("trace");

    const updated = await json<{ level: string }>(await request("/api/preferences/log-level"));
    expect(updated.level).toBe("trace");
  });

  test("log level preference rejects invalid levels", async () => {
    const response = await request("/api/preferences/log-level", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level: "verbose" }),
    });
    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ error: "validation_failed" });
  });

  test("source creation returns webhook URL only from create and list omits it", async () => {
    const created = await createSource();
    expect(created.webhookUrl).toContain(`/api/webhooks/${created.source.id}/`);
    const listResponse = await request("/api/sources");
    const list = await json<{ sources: Array<{ id: string; name: string; webhookUrl?: string }> }>(listResponse);
    const listed = list.sources.find((source) => source.id === created.source.id);
    expect(listed).toMatchObject(created.source);
    expect(listed?.webhookUrl).toBeUndefined();
  });

  test("webhook accepts valid token, derives source, and list omits markdown", async () => {
    const created = await createSource();
    const response = await webhook(created.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Done",
        shortDescription: "Finished",
        markdownContent: "# Complete",
        source: "spoofed",
      }),
    });
    expect(response.status).toBe(400);

    const validResponse = await webhook(created.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Done",
        shortDescription: "Finished",
        markdownContent: "# Complete",
      }),
    });
    expect(validResponse.status).toBe(201);
    const listResponse = await request("/api/notifications");
    const list = await json<{ notifications: Array<{ id: string; source: string; markdownContent?: string }> }>(listResponse);
    expect(list.notifications[0]?.source).toBe("Agent");
    expect(list.notifications[0]?.markdownContent).toBeUndefined();
  });

  test("webhook rejects invalid token and disabled source", async () => {
    const created = await createSource();
    const invalid = await webhook(created.webhookUrl.replace(/[^/]+$/, "bad-token"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
    });
    expect(invalid.status).toBe(401);
    await request(`/api/sources/${created.source.id}`, { method: "DELETE" });
    const disabled = await webhook(created.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
    });
    expect(disabled.status).toBe(410);
  });

  test("notification detail marks opened and deletes work", async () => {
    const created = await createSource();
    const webhookResponse = await webhook(created.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
    });

    const notification = await json<{ id: string }>(webhookResponse);
    const detailResponse = await request(`/api/notifications/${notification.id}`);
    const detail = await json<{ notification: { openedAt: string; markdownContent: string } }>(detailResponse);
    expect(detail.notification.openedAt).toBeTruthy();
    expect(detail.notification.markdownContent).toBe("C");
    const deleteResponse = await request(`/api/notifications/${notification.id}`, { method: "DELETE" });
    expect(deleteResponse.status).toBe(200);
    const missingResponse = await request(`/api/notifications/${notification.id}`);
    expect(missingResponse.status).toBe(404);
  });

  test("notification list returns global unread count after open and delete changes", async () => {
    const initial = await json<{ unreadCount: number }>(await request("/api/notifications"));
    const first = await createSource();
    const secondResponse = await request("/api/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Other" }),
    });
    const second = await json<{ source: { id: string }; webhookUrl: string }>(secondResponse);

    const firstWebhook = await webhook(first.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "First", shortDescription: "One", markdownContent: "First body" }),
    });
    const secondWebhook = await webhook(second.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Second", shortDescription: "Two", markdownContent: "Second body" }),
    });
    const firstNotification = await json<{ id: string }>(firstWebhook);
    const secondNotification = await json<{ id: string }>(secondWebhook);

    const filteredList = await json<{ notifications: unknown[]; unreadCount: number }>(
      await request(`/api/notifications?sourceId=${first.source.id}`),
    );
    expect(filteredList.notifications).toHaveLength(1);
    expect(filteredList.unreadCount).toBe(initial.unreadCount + 2);

    await request(`/api/notifications/${firstNotification.id}`);
    const afterOpen = await json<{ unreadCount: number }>(await request("/api/notifications"));
    expect(afterOpen.unreadCount).toBe(initial.unreadCount + 1);

    await request(`/api/notifications/${secondNotification.id}`, { method: "DELETE" });
    const afterDelete = await json<{ unreadCount: number }>(await request("/api/notifications"));
    expect(afterDelete.unreadCount).toBe(initial.unreadCount);
  });

  test("bulk delete can target one source or all", async () => {
    const first = await createSource();
    const secondResponse = await request("/api/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Other" }),
    });
    const second = await json<{ source: { id: string }; webhookUrl: string }>(secondResponse);
    for (const url of [first.webhookUrl, second.webhookUrl]) {
      await webhook(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
      });
    }
    const bySource = await request(`/api/notifications?sourceId=${first.source.id}`, { method: "DELETE" });
    expect(await json(bySource)).toMatchObject({ deletedCount: 1 });
    const firstList = await json<{ notifications: unknown[] }>(await request(`/api/notifications?sourceId=${first.source.id}`));
    expect(firstList.notifications).toHaveLength(0);
    const secondList = await json<{ notifications: unknown[] }>(await request(`/api/notifications?sourceId=${second.source.id}`));
    expect(secondList.notifications.length).toBeGreaterThanOrEqual(1);
    const all = await request("/api/notifications", { method: "DELETE" });
    const allBody = await json<{ deletedCount: number }>(all);
    expect(allBody.deletedCount).toBeGreaterThanOrEqual(1);
  });

  test("browser push routes are protected", async () => {
    const response = await request("/api/browser-push/config", undefined, { passkeyDisabled: false });
    expect(response.status).toBe(401);
    expect(await json(response)).toMatchObject({ error: "passkey_setup_required" });
  });

  test("browser push config is stable and subscriptions can be managed", async () => {
    const config = await json<{ publicKey: string }>(await request("/api/browser-push/config"));
    const secondConfig = await json<{ publicKey: string }>(await request("/api/browser-push/config"));
    expect(config.publicKey).toBeTruthy();
    expect(secondConfig.publicKey).toBe(config.publicKey);

    const endpoint = "https://push.example.test/subscription/one";
    const subscribe = await request("/api/browser-push/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Listen Test Browser" },
      body: JSON.stringify({ subscription: browserPushSubscription(endpoint) }),
    });
    expect(subscribe.status).toBe(201);
    expect(await json<{ subscribed: boolean }>(subscribe)).toEqual({ subscribed: true });

    const lookup = await request("/api/browser-push/subscriptions/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    expect(await json<{ subscribed: boolean }>(lookup)).toEqual({ subscribed: true });

    const unsubscribe = await request("/api/browser-push/subscriptions", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    expect(await json<{ subscribed: boolean }>(unsubscribe)).toEqual({ subscribed: false });

    const lookupAfterDelete = await request("/api/browser-push/subscriptions/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    expect(await json<{ subscribed: boolean }>(lookupAfterDelete)).toEqual({ subscribed: false });
  });

  test("webhook fanout sends compact browser push payloads to subscribed browsers", async () => {
    const endpoints = [
      "https://push.example.test/subscription/a",
      "https://push.example.test/subscription/b",
    ];
    for (const endpoint of endpoints) {
      await request("/api/browser-push/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: browserPushSubscription(endpoint) }),
      });
    }

    const delivered = new Promise<void>((resolve) => {
      const payloads: string[] = [];
      setBrowserPushSenderForTests(async (_subscription, payload) => {
        payloads.push(payload);
        if (payloads.length === endpoints.length) {
          const parsed = payloads.map((entry) => JSON.parse(entry) as Record<string, unknown>);
          expect(parsed.every((entry) => entry["title"] === "Done")).toBe(true);
          expect(parsed.every((entry) => entry["body"] === "Finished")).toBe(true);
          expect(parsed.every((entry) => entry["unreadCount"] === 1)).toBe(true);
          expect(parsed.every((entry) => entry["markdownContent"] === undefined)).toBe(true);
          expect(parsed.every((entry) => typeof (entry["data"] as Record<string, unknown> | undefined)?.["url"] === "string")).toBe(true);
          resolve();
        }
        return { statusCode: 201, body: "", headers: {} };
      });
    });

    const created = await createSource();
    const response = await webhook(created.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Done",
        shortDescription: "Finished",
        markdownContent: "# Complete",
      }),
    });
    expect(response.status).toBe(201);
    await delivered;
  });

  test("browser push removes expired endpoints and backs off temporary failures", async () => {
    const goneEndpoint = "https://push.example.test/subscription/gone";
    const temporaryEndpoint = "https://push.example.test/subscription/temporary";
    for (const endpoint of [goneEndpoint, temporaryEndpoint]) {
      await request("/api/browser-push/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: browserPushSubscription(endpoint) }),
      });
    }

    let attempts = 0;
    const attempted = new Promise<void>((resolve) => {
      setBrowserPushSenderForTests(async (subscription) => {
        attempts += 1;
        if (attempts === 2) {
          resolve();
        }
        if (subscription.endpoint === goneEndpoint) {
          throw { statusCode: 410 };
        }
        throw { statusCode: 503 };
      });
    });

    const created = await createSource();
    await webhook(created.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
    });
    await attempted;

    await waitForExpectation(() => {
      expect(getBrowserPushSubscriptionByEndpoint(goneEndpoint)).toBeUndefined();
      const temporarySubscription = getBrowserPushSubscriptionByEndpoint(temporaryEndpoint);
      expect(temporarySubscription?.failureCount).toBe(1);
      expect(temporarySubscription?.nextAttemptAt).toBeTruthy();
    });
  });
});
