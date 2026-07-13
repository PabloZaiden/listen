import "./../setup";
import { describe, expect, test } from "bun:test";
import type { RuntimeConfig } from "@pablozaiden/webapp/server";
import { BROWSER_PUSH_ENDPOINT_MAX_CHARS, WEBHOOK_JSON_BODY_MAX_BYTES } from "@listen/shared";
import { createFetchHandler } from "../../src/server";
import { setBrowserPushSenderForTests } from "../../src/core/browser-push";
import { createLogger, getLogLevel } from "../../src/core/logger";
import { resetWebhookRateLimitForTests, setWebhookRateLimitOptionsForTests } from "../../src/core/webhook-rate-limit";
import { getBrowserPushSubscriptionByEndpoint } from "../../src/persistence/browser-push";
import { getDatabase } from "../../src/persistence/database";

async function request(path: string, init?: RequestInit, config?: Partial<RuntimeConfig>): Promise<Response> {
  const handler = createFetchHandler({ passkeyDisabled: true, sameOriginDisabled: true, ...config });
  const response = await handler(new Request(`http://localhost${path}`, init));
  if (!response) {
    throw new Error("Request did not return a response");
  }
  return response;
}

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

function expectSecurityHeaders(response: Response): void {
  expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
}

async function expectRateLimited(response: Response): Promise<void> {
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBeTruthy();
  expect(await json<{ error: string; message: string }>(response)).toEqual({
    error: "rate_limited",
    message: "Too many webhook requests",
  });
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

function oversizedWebhookJson(): string {
  return JSON.stringify({
    title: "A",
    shortDescription: "B",
    markdownContent: "x".repeat(WEBHOOK_JSON_BODY_MAX_BYTES),
  });
}

function oversizedWebhookJsonStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"title":"A","shortDescription":"B","markdownContent":"'));
      controller.enqueue(encoder.encode("x".repeat(WEBHOOK_JSON_BODY_MAX_BYTES)));
      controller.enqueue(encoder.encode('"}'));
      controller.close();
    },
  });
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
    expectSecurityHeaders(response);
    expect(await json<{ ok: boolean }>(response)).toMatchObject({ ok: true });
  });

  test("protected routes reject when passkey is required and no passkey is configured", async () => {
    const response = await request("/api/sources", undefined, { passkeyDisabled: false });
    expect(response.status).toBe(401);
    expect(response.headers.get("x-webapp-passkey-required")).toBe("true");
    expect(await json(response)).toMatchObject({ error: "authentication_required" });
  });

  test("server kill route rejects when passkey is required and no passkey is configured", async () => {
    const response = await request("/api/server/kill", { method: "POST" }, { passkeyDisabled: false });
    expect(response.status).toBe(401);
    expect(response.headers.get("x-webapp-passkey-required")).toBe("true");
    expect(await json(response)).toMatchObject({ error: "authentication_required" });
  });

  test("passkey status reports setup state", async () => {
    const response = await request("/api/passkey-auth/status", undefined, { passkeyDisabled: false });
    expect(await json(response)).toMatchObject({
      passkeyConfigured: false,
      passkeyDisabled: false,
      bootstrapRequired: true,
      passkeyRequired: false,
      authenticated: false,
    });
  });

  test("log level preference can be changed at runtime", async () => {
    const initial = await json<{ level: string; fromEnv: boolean }>(await request("/api/preferences/log-level"));
    expect(initial.level).toBe("info");
    expect(initial.fromEnv).toBe(false);

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
    expect(await json(response)).toMatchObject({ error: "invalid_request_body" });
  });

  test("fetch handler applies explicit log level config", async () => {
    const response = await request("/api/config", undefined, { logLevel: "debug" });

    expect(response.status).toBe(200);
    expect(await json<{ logLevel: { level: string; fromEnv: boolean } }>(response)).toMatchObject({ logLevel: { level: "debug", fromEnv: true } });
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

  test("webhook rejects oversized JSON from content length", async () => {
    const created = await createSource();
    const body = oversizedWebhookJson();
    const response = await webhook(created.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(body).byteLength),
      },
      body,
    });

    expect(response.status).toBe(413);
    expect(await json(response)).toMatchObject({ error: "request_body_too_large" });
  });

  test("webhook rejects oversized streamed JSON without content length", async () => {
    const created = await createSource();
    const response = await webhook(created.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversizedWebhookJsonStream(),
    });

    expect(response.status).toBe(413);
    expect(await json(response)).toMatchObject({ error: "request_body_too_large" });
  });

  test("webhook rejects malformed JSON", async () => {
    const created = await createSource();
    const response = await webhook(created.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ error: "invalid_json" });
  });

  test("webhook global rate limit applies before source lookup", async () => {
    setWebhookRateLimitOptionsForTests({ globalLimit: 2, sourceLimit: 100 });
    const init = () => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect((await request("/api/webhooks/missing/token", init())).status).toBe(404);
    expect((await request("/api/webhooks/missing/token", init())).status).toBe(404);
    await expectRateLimited(await request("/api/webhooks/missing/token", init()));
  });

  test("webhook valid-source rate limit applies after token validation", async () => {
    setWebhookRateLimitOptionsForTests({ globalLimit: 100, sourceLimit: 1 });
    const created = await createSource();
    const init = () => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
    });

    expect((await webhook(created.webhookUrl, init())).status).toBe(201);
    await expectRateLimited(await webhook(created.webhookUrl, init()));
  });

  test("webhook rate limit hits log at debug instead of warn", async () => {
    const webhookLog = createLogger("api:webhooks");
    const originalWarn = webhookLog.warn;
    const originalDebug = webhookLog.debug;
    const warnCalls: unknown[][] = [];
    const debugCalls: unknown[][] = [];
    webhookLog.warn = ((...args: unknown[]) => {
      warnCalls.push(args);
    }) as typeof webhookLog.warn;
    webhookLog.debug = ((...args: unknown[]) => {
      debugCalls.push(args);
    }) as typeof webhookLog.debug;

    try {
      const init = () => ({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
      });

      setWebhookRateLimitOptionsForTests({ globalLimit: 0, sourceLimit: 100 });
      await expectRateLimited(await request("/api/webhooks/missing/token", init()));
      expect(warnCalls).toHaveLength(0);
      expect(debugCalls.some((call) => call[0] === "Global webhook rate limit exceeded")).toBe(true);

      debugCalls.length = 0;
      setWebhookRateLimitOptionsForTests({ globalLimit: 100, sourceLimit: 0 });
      const created = await createSource();
      await expectRateLimited(await webhook(created.webhookUrl, init()));
      expect(warnCalls).toHaveLength(0);
      expect(debugCalls.some((call) => call[0] === "Source webhook rate limit exceeded")).toBe(true);
    } finally {
      resetWebhookRateLimitForTests();
      webhookLog.warn = originalWarn;
      webhookLog.debug = originalDebug;
    }
  });

  test("webhook rejects invalid token and deleted source", async () => {
    const created = await createSource();
    const invalid = await webhook(created.webhookUrl.replace(/[^/]+$/, "bad-token"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
    });
    expect(invalid.status).toBe(401);
    await request(`/api/sources/${created.source.id}`, { method: "DELETE" });
    const deleted = await webhook(created.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
    });
    expect(deleted.status).toBe(404);
  });

  test("deleting a source deletes its notifications", async () => {
    const first = await createSource();
    const secondResponse = await request("/api/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Other" }),
    });
    const second = await json<{ source: { id: string }; webhookUrl: string }>(secondResponse);
    for (const url of [first.webhookUrl, second.webhookUrl]) {
      const webhookResponse = await webhook(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
      });
      expect(webhookResponse.status).toBe(201);
    }

    const deleted = await request(`/api/sources/${first.source.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);

    const sources = await json<{ sources: Array<{ id: string }> }>(await request("/api/sources"));
    expect(sources.sources.some((source) => source.id === first.source.id)).toBe(false);

    const firstList = await json<{ notifications: unknown[] }>(await request(`/api/notifications?sourceId=${first.source.id}`));
    expect(firstList.notifications).toHaveLength(0);
    const secondList = await json<{ notifications: unknown[] }>(await request(`/api/notifications?sourceId=${second.source.id}`));
    expect(secondList.notifications).toHaveLength(1);
  });

  test("source schema delete cascades notifications", async () => {
    const created = await createSource();
    const webhookResponse = await webhook(created.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
    });
    expect(webhookResponse.status).toBe(201);

    getDatabase().query("DELETE FROM webhook_sources WHERE id = $id").run({ id: created.source.id });

    const list = await json<{ notifications: unknown[] }>(await request(`/api/notifications?sourceId=${created.source.id}`));
    expect(list.notifications).toHaveLength(0);
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

  test("notification read and unread mutations update unread counts", async () => {
    const created = await createSource();
    const webhookResponse = await webhook(created.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
    });
    const notification = await json<{ id: string }>(webhookResponse);

    const afterCreate = await json<{ unreadCount: number }>(await request("/api/notifications"));
    const initialUnreadCount = afterCreate.unreadCount - 1;

    const readResponse = await request(`/api/notifications/${notification.id}/read`, { method: "POST" });
    expect(readResponse.status).toBe(200);
    expect((await json<{ notification: { openedAt?: string } }>(readResponse)).notification.openedAt).toBeTruthy();
    const afterRead = await json<{ unreadCount: number }>(await request("/api/notifications"));
    expect(afterRead.unreadCount).toBe(initialUnreadCount);

    const unreadResponse = await request(`/api/notifications/${notification.id}/unread`, { method: "POST" });
    expect(unreadResponse.status).toBe(200);
    expect((await json<{ notification: { openedAt?: string } }>(unreadResponse)).notification.openedAt).toBeUndefined();
    const afterUnread = await json<{ unreadCount: number }>(await request("/api/notifications"));
    expect(afterUnread.unreadCount).toBe(initialUnreadCount + 1);
  });

  test("bulk mark read can target one source", async () => {
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

    const bulkRead = await request(`/api/notifications/read?sourceId=${first.source.id}`, { method: "POST" });
    expect(await json(bulkRead)).toMatchObject({ updatedCount: 1 });
    const firstUnread = await json<{ notifications: unknown[] }>(await request(`/api/notifications?sourceId=${first.source.id}&opened=false`));
    expect(firstUnread.notifications).toHaveLength(0);
    const secondUnread = await json<{ notifications: unknown[] }>(await request(`/api/notifications?sourceId=${second.source.id}&opened=false`));
    expect(secondUnread.notifications).toHaveLength(1);
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
    expect(await json(response)).toMatchObject({ error: "authentication_required" });
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

  test("browser push subscription rejects oversized endpoints", async () => {
    const response = await request("/api/browser-push/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: browserPushSubscription(`https://push.example.test/${"x".repeat(BROWSER_PUSH_ENDPOINT_MAX_CHARS)}`) }),
    });

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ error: "invalid_request_body" });
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
