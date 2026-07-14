import "./../setup";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { sqliteWebAppStore, type UserRecord } from "@pablozaiden/webapp/server";
import { sourceMutationResponseSchema, sourceResponseSchema, type SourceMutationResponse } from "@listen/contracts";
import { BROWSER_PUSH_ENDPOINT_MAX_CHARS, LIST_NOTIFICATIONS_DEFAULT_LIMIT, LIST_NOTIFICATIONS_MAX_LIMIT, WEBHOOK_JSON_BODY_MAX_BYTES } from "@listen/shared";
import { createFetchHandler, getWebhookCallerKey, type ListenTestOptions } from "../../src/server";
import { setBrowserPushSenderForTests } from "../../src/core/browser-push";
import { createWebhookRateLimiter, type WebhookRateLimitOptions } from "../../src/core/webhook-rate-limit";
import { getBrowserPushSubscriptionByEndpoint, markBrowserPushSubscriptionFailed } from "../../src/persistence/browser-push";
import { getDatabase } from "../../src/persistence/database";

async function request(path: string, init?: RequestInit, options?: ListenTestOptions): Promise<Response> {
  const handler = createFetchHandler({ passkeyDisabled: true, sameOriginDisabled: true, ...options });
  const response = await handler(new Request(`http://localhost${path}`, init));
  if (!response) {
    throw new Error("Request did not return a response");
  }
  return response;
}

interface WebhookTestClient {
  setCallerKey(key: string): void;
  request(path: string, init?: RequestInit): Promise<Response>;
  webhook(webhookUrl: string, init: RequestInit): Promise<Response>;
}

function createWebhookTestClient(options: WebhookRateLimitOptions): WebhookTestClient {
  let callerKey = "test-caller";
  const handler = createFetchHandler(
    { passkeyDisabled: true, sameOriginDisabled: true },
    {
      webhookRateLimiter: createWebhookRateLimiter(options),
      webhookCallerKeyResolver: () => callerKey,
    },
  );

  async function send(path: string, init?: RequestInit): Promise<Response> {
    const response = await handler(new Request(`http://localhost${path}`, init));
    if (!response) {
      throw new Error("Request did not return a response");
    }
    return response;
  }

  return {
    setCallerKey(key) {
      callerKey = key;
    },
    request: send,
    webhook(webhookUrl, init) {
      return send(new URL(webhookUrl).pathname, init);
    },
  };
}

interface AuthenticatedTestUser {
  userId: string;
  token: string;
}

function frameworkStore() {
  const dataDir = process.env["LISTEN_DATA_DIR"];
  if (!dataDir) {
    throw new Error("LISTEN_DATA_DIR is required for authenticated test fixtures");
  }
  const store = sqliteWebAppStore({ dataDir, fileName: "listen.db" });
  store.initialize();
  return store;
}

function createAuthenticatedTestUser(username: string): AuthenticatedTestUser {
  const store = frameworkStore();
  const createdAt = new Date().toISOString();
  const user: UserRecord = {
    id: crypto.randomUUID(),
    username,
    role: "user",
    passkeyConfigured: false,
    authVersion: 1,
    createdAt,
    updatedAt: createdAt,
  };
  store.createUser(user);
  const token = `listen_test_${crypto.randomUUID()}`;
  store.saveApiKey({
    id: crypto.randomUUID(),
    userId: user.id,
    name: `${username} test key`,
    prefix: "listen_test",
    tokenHash: createHash("sha256").update(token, "utf8").digest("base64url"),
    scopes: ["*"],
    createdAt,
  });
  return { userId: user.id, token };
}

async function requestAs(user: AuthenticatedTestUser, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${user.token}`);
  return request(path, { ...init, headers });
}

function currentOwnerId(): string {
  const owner = frameworkStore().getOwnerUser();
  if (!owner) {
    throw new Error("Expected the disabled-auth owner to exist");
  }
  return owner.id;
}

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function parseSourceMutationResponse(response: Response): Promise<SourceMutationResponse> {
  return sourceMutationResponseSchema.parse(await json<unknown>(response));
}

async function expectRateLimited(response: Response): Promise<void> {
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBeTruthy();
  expect(await json<{ error: string }>(response)).toMatchObject({ error: "rate_limited" });
}

async function createSource(): Promise<SourceMutationResponse> {
  const response = await request("/api/sources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Agent" }),
  });
  expect(response.status).toBe(201);
  return parseSourceMutationResponse(response);
}

async function webhook(webhookUrl: string, init: RequestInit): Promise<Response> {
  const url = new URL(webhookUrl);
  return request(url.pathname, init);
}

function browserPushSubscription(endpoint: string, p256dh = "p256dh-key", auth = "auth-key"): unknown {
  return {
    endpoint,
    expirationTime: null,
    keys: {
      p256dh,
      auth,
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
  test("serves the Listen service worker as an executable public asset", async () => {
    const response = await request("/service-worker");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(response.headers.get("service-worker-allowed")).toBe("/");
    expect((await response.text()).length).toBeGreaterThan(0);
  });

  test("protected Listen routes reject unauthenticated requests", async () => {
    const response = await request("/api/sources", undefined, { passkeyDisabled: false });
    expect(response.status).toBe(401);
    expect(await json(response)).toMatchObject({ error: "authentication_required" });
  });

  test("fetch handler includes the trusted proxy prefix in webhook URLs", async () => {
    const handler = createFetchHandler({
      publicBaseUrl: "https://public.example",
      trustProxy: { enabled: true, headers: ["prefix"], chain: "first" },
    });
    const response = await handler(new Request("http://internal.example/api/sources", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-prefix": "/listen/",
      },
      body: JSON.stringify({ name: "Prefixed" }),
    }));

    expect(response?.status).toBe(201);
    expect((await parseSourceMutationResponse(response!)).webhookUrl).toMatch(/^https:\/\/public\.example\/listen\/api\/webhooks\//);
  });

  test("webhook caller key uses the Bun peer address instead of forwarded headers", () => {
    const request = new Request("http://localhost/api/webhooks/missing/token", {
      headers: { "x-forwarded-for": "203.0.113.8" },
    });
    const server = {
      requestIP: () => ({ address: "198.51.100.7", port: 4321, family: "IPv4" as const }),
    };

    expect(getWebhookCallerKey(request, server)).toBe("198.51.100.7");
    expect(getWebhookCallerKey(request, undefined)).toBe("unknown");
  });

  test("source creation returns webhook URL only from create and list omits it", async () => {
    const created = await createSource();
    expect(created.webhookUrl).toContain(`/api/webhooks/${created.source.id}/`);
    const listResponse = await request("/api/sources");
    const list = await json<{ sources: unknown[] }>(listResponse);
    const listed = list.sources.find((source) => {
      if (typeof source !== "object" || source === null || !("id" in source)) return false;
      return source.id === created.source.id;
    });
    expect(sourceResponseSchema.parse(listed)).toEqual(created.source);
  });

  test("source token rotation returns a safe response and invalidates the previous URL", async () => {
    const created = await createSource();
    const rotateResponse = await request(`/api/sources/${created.source.id}/token/rotate`, { method: "POST" });
    expect(rotateResponse.status).toBe(200);
    const rotated = await parseSourceMutationResponse(rotateResponse);
    expect(rotated.source).toMatchObject({
      id: created.source.id,
      name: created.source.name,
      createdAt: created.source.createdAt,
    });
    expect(rotated.webhookUrl).not.toBe(created.webhookUrl);

    const init = () => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Rotated", shortDescription: "A", markdownContent: "A" }),
    });
    expect((await webhook(created.webhookUrl, init())).status).toBe(401);
    expect((await webhook(rotated.webhookUrl, init())).status).toBe(201);
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

  test("notification query parameters validate the shared schema for listing and bulk deletion", async () => {
    const defaultPage = await json<{ pagination: { limit: number; offset: number } }>(
      await request("/api/notifications"),
    );
    expect(defaultPage.pagination).toMatchObject({
      limit: LIST_NOTIFICATIONS_DEFAULT_LIMIT,
      offset: 0,
    });

    const invalidQueries = [
      "limit=0",
      "limit=-1",
      `limit=${LIST_NOTIFICATIONS_MAX_LIMIT + 1}`,
      "limit=1.5",
      "limit=not-a-number",
      "offset=-1",
      "offset=1.5",
      "offset=not-a-number",
      "read=maybe",
      "unexpected=value",
    ];
    for (const query of invalidQueries) {
      const response = await request(`/api/notifications?${query}`);
      expect(response.status).toBe(400);
      expect(await json<{ error: string }>(response)).toMatchObject({ error: "invalid_request_query" });
    }

    const created = await createSource();
    const firstWebhook = await webhook(created.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "First", shortDescription: "A", markdownContent: "A" }),
    });
    const secondWebhook = await webhook(created.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Second", shortDescription: "B", markdownContent: "B" }),
    });
    expect(firstWebhook.status).toBe(201);
    expect(secondWebhook.status).toBe(201);
    const firstNotification = await json<{ id: string }>(firstWebhook);
    await request(`/api/notifications/${firstNotification.id}`);

    const read = await json<{ notifications: unknown[]; pagination: { limit: number; offset: number; total: number } }>(
      await request(`/api/notifications?sourceId=${created.source.id}&limit=1&offset=0&read=true`),
    );
    expect(read.notifications).toHaveLength(1);
    expect(read.pagination).toEqual({ limit: 1, offset: 0, total: 1 });

    const unread = await json<{ notifications: unknown[] }>(
      await request(`/api/notifications?sourceId=${created.source.id}&read=false`),
    );
    expect(unread.notifications).toHaveLength(1);

    for (const query of ["read=maybe", "unexpected=value", `limit=${LIST_NOTIFICATIONS_MAX_LIMIT + 1}`, "offset=-1"]) {
      const response = await request(`/api/notifications?${query}`, { method: "DELETE" });
      expect(response.status).toBe(400);
      expect(await json<{ error: string }>(response)).toMatchObject({ error: "invalid_request_query" });
    }

    const deleted = await json<{ deletedCount: number }>(
      await request(`/api/notifications?sourceId=${created.source.id}&read=true`, { method: "DELETE" }),
    );
    expect(deleted.deletedCount).toBe(1);
    const remaining = await json<{ notifications: unknown[] }>(
      await request(`/api/notifications?sourceId=${created.source.id}`),
    );
    expect(remaining.notifications).toHaveLength(1);
  });

  test("notification pagination exposes complete global and source-filtered pages", async () => {
    const first = await createSource();
    const second = await createSource();
    for (let index = 0; index < LIST_NOTIFICATIONS_DEFAULT_LIMIT + 1; index += 1) {
      const response = await webhook(first.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `Notification ${index}`,
          shortDescription: "Page",
          markdownContent: "Content",
        }),
      });
      expect(response.status).toBe(201);
    }
    const secondSourceResponse = await webhook(second.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Other source",
        shortDescription: "Page",
        markdownContent: "Content",
      }),
    });
    expect(secondSourceResponse.status).toBe(201);

    type NotificationPage = {
      notifications: Array<{ id: string }>;
      pagination: { limit: number; offset: number; total: number; nextOffset?: number };
    };
    const globalFirst = await json<NotificationPage>(await request("/api/notifications"));
    expect(globalFirst.notifications).toHaveLength(LIST_NOTIFICATIONS_DEFAULT_LIMIT);
    expect(globalFirst.pagination.limit).toBe(LIST_NOTIFICATIONS_DEFAULT_LIMIT);
    expect(globalFirst.pagination.offset).toBe(0);
    expect(globalFirst.pagination.total).toBeGreaterThanOrEqual(LIST_NOTIFICATIONS_DEFAULT_LIMIT + 2);
    expect(globalFirst.pagination.nextOffset).toBe(LIST_NOTIFICATIONS_DEFAULT_LIMIT);
    const globalSecond = await json<NotificationPage>(
      await request(`/api/notifications?offset=${globalFirst.pagination.nextOffset}`),
    );
    expect(globalSecond.notifications).toHaveLength(globalFirst.pagination.total - LIST_NOTIFICATIONS_DEFAULT_LIMIT);
    expect(globalSecond.pagination.nextOffset).toBeUndefined();
    expect(new Set([
      ...globalFirst.notifications.map(({ id }) => id),
      ...globalSecond.notifications.map(({ id }) => id),
    ]).size).toBe(globalFirst.pagination.total);
    expect(globalFirst.notifications.some(({ id }) => globalSecond.notifications.some((notification) => notification.id === id))).toBe(false);

    const filteredFirst = await json<NotificationPage>(
      await request(`/api/notifications?sourceId=${first.source.id}`),
    );
    expect(filteredFirst.notifications).toHaveLength(LIST_NOTIFICATIONS_DEFAULT_LIMIT);
    expect(filteredFirst.pagination).toEqual({
      limit: LIST_NOTIFICATIONS_DEFAULT_LIMIT,
      offset: 0,
      total: LIST_NOTIFICATIONS_DEFAULT_LIMIT + 1,
      nextOffset: LIST_NOTIFICATIONS_DEFAULT_LIMIT,
    });
    const filteredSecond = await json<NotificationPage>(
      await request(`/api/notifications?sourceId=${first.source.id}&offset=${filteredFirst.pagination.nextOffset}`),
    );
    expect(filteredSecond.notifications).toHaveLength(1);
    expect(filteredSecond.pagination.nextOffset).toBeUndefined();
    expect(filteredFirst.notifications.some(({ id }) => filteredSecond.notifications.some((notification) => notification.id === id))).toBe(false);
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

  test("webhook validates JSON content types", async () => {
    const created = await createSource();
    const body = JSON.stringify({ title: "Accepted", shortDescription: "A", markdownContent: "B" });
    const accepted = await webhook(created.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/vnd.listen+json" },
      body,
    });
    expect(accepted.status).toBe(201);

    const rejected = await webhook(created.webhookUrl, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body,
    });
    expect(rejected.status).toBe(400);
    expect(await json(rejected)).toMatchObject({ error: "invalid_request_content_type" });
  });

  test("webhook caller rate limit isolates invalid traffic by caller", async () => {
    const client = createWebhookTestClient({
      callerLimit: 2,
      sourceLimit: 100,
      emergencyGlobalLimit: 100,
    });
    const created = await createSource();
    const init = () => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    client.setCallerKey("caller-a");
    expect((await client.request("/api/webhooks/missing/token", init())).status).toBe(404);
    expect((await client.request("/api/webhooks/missing/token", init())).status).toBe(404);
    await expectRateLimited(await client.request("/api/webhooks/missing/token", init()));

    client.setCallerKey("caller-b");
    expect((await client.webhook(created.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
    })).status).toBe(201);
  });

  test("webhook valid-source rate limit applies after token validation", async () => {
    const client = createWebhookTestClient({
      callerLimit: 100,
      sourceLimit: 1,
      emergencyGlobalLimit: 100,
    });
    const created = await createSource();
    const init = () => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
    });

    expect((await client.webhook(created.webhookUrl, init())).status).toBe(201);
    await expectRateLimited(await client.webhook(created.webhookUrl, init()));
  });

  test("invalid webhook tokens do not consume the validated-source bucket", async () => {
    const client = createWebhookTestClient({
      callerLimit: 100,
      sourceLimit: 1,
      emergencyGlobalLimit: 100,
    });
    const created = await createSource();
    const init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
    };

    const invalid = await client.webhook(created.webhookUrl.replace(/[^/]+$/, "bad-token"), init);
    expect(invalid.status).toBe(401);
    expect((await client.webhook(created.webhookUrl, init)).status).toBe(201);
    await expectRateLimited(await client.webhook(created.webhookUrl, init));
  });

  test("one valid source does not consume another source's rate limit", async () => {
    const client = createWebhookTestClient({
      callerLimit: 100,
      sourceLimit: 1,
      emergencyGlobalLimit: 100,
    });
    const first = await createSource();
    const secondResponse = await request("/api/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Second" }),
    });
    expect(secondResponse.status).toBe(201);
    const second = await parseSourceMutationResponse(secondResponse);
    const init = () => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
    });

    expect((await client.webhook(first.webhookUrl, init())).status).toBe(201);
    await expectRateLimited(await client.webhook(first.webhookUrl, init()));
    expect((await client.webhook(second.webhookUrl, init())).status).toBe(201);
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
    const second = await parseSourceMutationResponse(secondResponse);
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

  test("source deletion rolls back when source deletion fails", async () => {
    const created = await createSource();
    const webhookResponse = await webhook(created.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
    });
    expect(webhookResponse.status).toBe(201);

    getDatabase().exec(`
      CREATE TRIGGER fail_source_delete
      BEFORE DELETE ON webhook_sources
      BEGIN
        SELECT RAISE(ABORT, 'injected source deletion failure');
      END;
    `);

    try {
      const deleteResponse = await request(`/api/sources/${created.source.id}`, { method: "DELETE" });
      expect(deleteResponse.status).toBe(500);
    } finally {
      getDatabase().exec("DROP TRIGGER fail_source_delete");
    }

    const sources = await json<{ sources: Array<{ id: string }> }>(await request("/api/sources"));
    expect(sources.sources.some((source) => source.id === created.source.id)).toBe(true);
    const notifications = await json<{ notifications: unknown[] }>(
      await request(`/api/notifications?sourceId=${created.source.id}`),
    );
    expect(notifications.notifications).toHaveLength(1);
  });

  test("notification detail marks read and deletes work", async () => {
    const created = await createSource();
    const webhookResponse = await webhook(created.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
    });

    const notification = await json<{ id: string }>(webhookResponse);
    const beforeDetail = await json<{ unreadCount: number }>(await request("/api/notifications"));
    const detailResponse = await request(`/api/notifications/${notification.id}`);
    const detail = await json<{ notification: { readAt: string; markdownContent: string } }>(detailResponse);
    expect(detail.notification.readAt).toBeTruthy();
    expect(detail.notification.markdownContent).toBe("C");
    const afterFirstDetail = await json<{ unreadCount: number }>(await request("/api/notifications"));
    expect(afterFirstDetail.unreadCount).toBe(beforeDetail.unreadCount - 1);

    const repeatedDetail = await request(`/api/notifications/${notification.id}`);
    expect(repeatedDetail.status).toBe(200);
    const afterRepeatedDetail = await json<{ unreadCount: number }>(await request("/api/notifications"));
    expect(afterRepeatedDetail.unreadCount).toBe(afterFirstDetail.unreadCount);

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
    expect((await json<{ notification: { readAt?: string } }>(readResponse)).notification.readAt).toBeTruthy();
    const afterRead = await json<{ unreadCount: number }>(await request("/api/notifications"));
    expect(afterRead.unreadCount).toBe(initialUnreadCount);

    const repeatedReadResponse = await request(`/api/notifications/${notification.id}/read`, { method: "POST" });
    expect(repeatedReadResponse.status).toBe(200);
    expect((await json<{ notification: { readAt?: string } }>(repeatedReadResponse)).notification.readAt).toBeTruthy();
    const afterRepeatedRead = await json<{ unreadCount: number }>(await request("/api/notifications"));
    expect(afterRepeatedRead.unreadCount).toBe(initialUnreadCount);

    const unreadResponse = await request(`/api/notifications/${notification.id}/unread`, { method: "POST" });
    expect(unreadResponse.status).toBe(200);
    expect((await json<{ notification: { readAt?: string } }>(unreadResponse)).notification.readAt).toBeUndefined();
    const afterUnread = await json<{ unreadCount: number }>(await request("/api/notifications"));
    expect(afterUnread.unreadCount).toBe(initialUnreadCount + 1);

    const repeatedUnreadResponse = await request(`/api/notifications/${notification.id}/unread`, { method: "POST" });
    expect(repeatedUnreadResponse.status).toBe(200);
    expect((await json<{ notification: { readAt?: string } }>(repeatedUnreadResponse)).notification.readAt).toBeUndefined();
    const afterRepeatedUnread = await json<{ unreadCount: number }>(await request("/api/notifications"));
    expect(afterRepeatedUnread.unreadCount).toBe(initialUnreadCount + 1);
  });

  test("bulk mark read can target one source", async () => {
    const first = await createSource();
    const secondResponse = await request("/api/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Other" }),
    });
    const second = await parseSourceMutationResponse(secondResponse);

    for (const url of [first.webhookUrl, second.webhookUrl]) {
      await webhook(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "A", shortDescription: "B", markdownContent: "C" }),
      });
    }

    const bulkRead = await request(`/api/notifications/read?sourceId=${first.source.id}`, { method: "POST" });
    expect(await json(bulkRead)).toMatchObject({ updatedCount: 1 });
    const firstUnread = await json<{ notifications: unknown[] }>(await request(`/api/notifications?sourceId=${first.source.id}&read=false`));
    expect(firstUnread.notifications).toHaveLength(0);
    const secondUnread = await json<{ notifications: unknown[] }>(await request(`/api/notifications?sourceId=${second.source.id}&read=false`));
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
    const second = await parseSourceMutationResponse(secondResponse);

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
    const second = await parseSourceMutationResponse(secondResponse);
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
    expect(await json<{ subscribed: boolean; outcome: string }>(subscribe)).toEqual({ subscribed: true, outcome: "created" });

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
      const ownerId = currentOwnerId();
      expect(getBrowserPushSubscriptionByEndpoint(goneEndpoint, ownerId)).toBeUndefined();
      const temporarySubscription = getBrowserPushSubscriptionByEndpoint(temporaryEndpoint, ownerId);
      expect(temporarySubscription?.failureCount).toBe(1);
      expect(temporarySubscription?.nextAttemptAt).toBeTruthy();
    });
  });

  test("browser push claims transfer ownership explicitly and keep delivery owner-scoped", async () => {
    const userA = createAuthenticatedTestUser("push-claim-a");
    const userB = createAuthenticatedTestUser("push-claim-b");
    const endpoint = "https://push.example.test/ownership/transfer";
    const claim = async (user: AuthenticatedTestUser, p256dh: string, auth: string): Promise<{ subscribed: boolean; outcome: string }> => {
      const response = await requestAs(user, "/api/browser-push/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: browserPushSubscription(endpoint, p256dh, auth) }),
      });
      expect(response.status).toBe(201);
      return json(response);
    };

    expect(await claim(userA, "a-p256dh", "a-auth")).toEqual({ subscribed: true, outcome: "created" });

    expect(await claim(userA, "a-refreshed-p256dh", "a-refreshed-auth")).toEqual({
      subscribed: true,
      outcome: "refreshed",
    });
    expect(getBrowserPushSubscriptionByEndpoint(endpoint, userA.userId)).toMatchObject({
      userId: userA.userId,
      p256dh: "a-refreshed-p256dh",
      auth: "a-refreshed-auth",
      failureCount: 0,
    });

    markBrowserPushSubscriptionFailed(
      endpoint,
      userA.userId,
      "2026-07-14T07:00:00.000Z",
      "2999-01-01T00:00:00.000Z",
    );
    expect(getBrowserPushSubscriptionByEndpoint(endpoint, userA.userId)).toMatchObject({
      failureCount: 1,
      nextAttemptAt: "2999-01-01T00:00:00.000Z",
    });

    const transfer = await claim(userB, "b-p256dh", "b-auth");
    expect(transfer).toEqual({ subscribed: true, outcome: "transferred" });
    const transferBody = JSON.stringify(transfer);
    expect(transferBody).not.toContain(endpoint);
    expect(transferBody).not.toContain("b-p256dh");
    expect(transferBody).not.toContain("b-auth");

    expect(getBrowserPushSubscriptionByEndpoint(endpoint, userA.userId)).toBeUndefined();
    expect(getBrowserPushSubscriptionByEndpoint(endpoint, userB.userId)).toMatchObject({
      userId: userB.userId,
      p256dh: "b-p256dh",
      auth: "b-auth",
      failureCount: 0,
    });
    const transferred = getBrowserPushSubscriptionByEndpoint(endpoint, userB.userId);
    expect(transferred?.lastFailureAt).toBeUndefined();
    expect(transferred?.nextAttemptAt).toBeUndefined();
    expect(transferred).not.toHaveProperty("disabledAt");

    const lookupFromA = await requestAs(userA, "/api/browser-push/subscriptions/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    expect(await json<{ subscribed: boolean }>(lookupFromA)).toEqual({ subscribed: false });

    const deleteFromA = await requestAs(userA, "/api/browser-push/subscriptions", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    expect(await json<{ subscribed: boolean }>(deleteFromA)).toEqual({ subscribed: false });

    const lookupFromB = await requestAs(userB, "/api/browser-push/subscriptions/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    expect(await json<{ subscribed: boolean }>(lookupFromB)).toEqual({ subscribed: true });

    const createOwnedSource = async (user: AuthenticatedTestUser, name: string): Promise<SourceMutationResponse> => {
      const response = await requestAs(user, "/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      expect(response.status).toBe(201);
      return parseSourceMutationResponse(response);
    };
    const sourceA = await createOwnedSource(userA, "Push claim A");
    const sourceB = await createOwnedSource(userB, "Push claim B");
    const deliveredEndpoints: string[] = [];
    setBrowserPushSenderForTests(async (subscription) => {
      deliveredEndpoints.push(subscription.endpoint);
      return { statusCode: 201, body: "", headers: {} };
    });

    const notificationInit = (title: string) => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, shortDescription: "Push claim", markdownContent: title }),
    });
    expect((await webhook(sourceA.webhookUrl, notificationInit("Prior owner"))).status).toBe(201);
    expect(deliveredEndpoints).toEqual([]);
    expect((await webhook(sourceB.webhookUrl, notificationInit("New owner"))).status).toBe(201);
    await waitForExpectation(() => {
      expect(deliveredEndpoints).toEqual([endpoint]);
    });
  });

  test("authenticated users cannot access each other's sources, notifications, or push subscriptions", async () => {
    const userA = createAuthenticatedTestUser("ownership-a");
    const userB = createAuthenticatedTestUser("ownership-b");
    const createOwnedSource = async (user: AuthenticatedTestUser, name: string): Promise<SourceMutationResponse> => {
      const response = await requestAs(user, "/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      expect(response.status).toBe(201);
      return parseSourceMutationResponse(response);
    };
    const sourceA = await createOwnedSource(userA, "User A source");
    const sourceB = await createOwnedSource(userB, "User B source");

    const sourcesForA = await json<{ sources: Array<{ id: string }> }>(await requestAs(userA, "/api/sources"));
    const sourcesForB = await json<{ sources: Array<{ id: string }> }>(await requestAs(userB, "/api/sources"));
    expect(sourcesForA.sources.map((source) => source.id)).toEqual([sourceA.source.id]);
    expect(sourcesForB.sources.map((source) => source.id)).toEqual([sourceB.source.id]);

    const endpointA = "https://push.example.test/ownership/a";
    const endpointB = "https://push.example.test/ownership/b";
    for (const [user, endpoint] of [[userA, endpointA], [userB, endpointB]] as const) {
      const response = await requestAs(user, "/api/browser-push/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: browserPushSubscription(endpoint) }),
      });
      expect(response.status).toBe(201);
    }

    const deliveredEndpoints: string[] = [];
    setBrowserPushSenderForTests(async (subscription) => {
      deliveredEndpoints.push(subscription.endpoint);
      return { statusCode: 201, body: "", headers: {} };
    });

    const webhookResponse = await webhook(sourceA.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "User A notification", shortDescription: "A", markdownContent: "A" }),
    });
    expect(webhookResponse.status).toBe(201);
    await waitForExpectation(() => {
      expect(deliveredEndpoints).toEqual([endpointA]);
    });

    const notificationsForA = await json<{ notifications: Array<{ id: string }>; pagination: { total: number } }>(
      await requestAs(userA, "/api/notifications"),
    );
    const notificationsForB = await json<{ notifications: unknown[]; pagination: { total: number } }>(
      await requestAs(userB, "/api/notifications"),
    );
    expect(notificationsForA.pagination.total).toBe(1);
    expect(notificationsForA.notifications).toHaveLength(1);
    expect(notificationsForB.pagination.total).toBe(0);
    expect(notificationsForB.notifications).toHaveLength(0);

    const notificationId = notificationsForA.notifications[0]?.id;
    expect(notificationId).toBeTruthy();
    for (const [path, method] of [
      [`/api/notifications/${notificationId}`, "GET"],
      [`/api/notifications/${notificationId}/read`, "POST"],
      [`/api/notifications/${notificationId}/unread`, "POST"],
      [`/api/notifications/${notificationId}`, "DELETE"],
    ] as const) {
      const response = await requestAs(userB, path, { method });
      expect(response.status).toBe(404);
    }

    const markReadForB = await requestAs(userB, "/api/notifications/read", { method: "POST" });
    expect(await json<{ success: boolean; updatedCount: number }>(markReadForB)).toEqual({ success: true, updatedCount: 0 });
    const deleteForB = await requestAs(userB, "/api/notifications", { method: "DELETE" });
    expect(await json<{ deletedCount: number }>(deleteForB)).toEqual({ deletedCount: 0 });

    const rotateForB = await requestAs(userB, `/api/sources/${sourceA.source.id}/token/rotate`, { method: "POST" });
    expect(rotateForB.status).toBe(404);
    const deleteSourceForB = await requestAs(userB, `/api/sources/${sourceA.source.id}`, { method: "DELETE" });
    expect(deleteSourceForB.status).toBe(404);
    const sourcesAfterDeleteAttempt = await json<{ sources: Array<{ id: string }> }>(await requestAs(userA, "/api/sources"));
    expect(sourcesAfterDeleteAttempt.sources.map((source) => source.id)).toEqual([sourceA.source.id]);
    const notificationsAfterDeleteAttempt = await json<{ pagination: { total: number } }>(
      await requestAs(userA, "/api/notifications"),
    );
    expect(notificationsAfterDeleteAttempt.pagination.total).toBe(1);

    const lookupAFromB = await requestAs(userB, "/api/browser-push/subscriptions/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: endpointA }),
    });
    expect(await json<{ subscribed: boolean }>(lookupAFromB)).toEqual({ subscribed: false });
    const unsubscribeAFromB = await requestAs(userB, "/api/browser-push/subscriptions", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: endpointA }),
    });
    expect(await json<{ subscribed: boolean }>(unsubscribeAFromB)).toEqual({ subscribed: false });
    const lookupAFromA = await requestAs(userA, "/api/browser-push/subscriptions/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: endpointA }),
    });
    expect(await json<{ subscribed: boolean }>(lookupAFromA)).toEqual({ subscribed: true });

    const persistedA = getBrowserPushSubscriptionByEndpoint(endpointA, userA.userId);
    const persistedB = getBrowserPushSubscriptionByEndpoint(endpointB, userB.userId);
    expect(persistedA?.lastSuccessAt).toBeTruthy();
    expect(persistedB?.lastSuccessAt).toBeUndefined();

    const sourcesAfterCrossUserMutations = await json<{ sources: Array<{ id: string }> }>(await requestAs(userA, "/api/sources"));
    expect(sourcesAfterCrossUserMutations.sources.map((source) => source.id)).toEqual([sourceA.source.id]);
    const notificationsAfterCrossUserMutations = await json<{ pagination: { total: number } }>(
      await requestAs(userA, "/api/notifications"),
    );
    expect(notificationsAfterCrossUserMutations.pagination.total).toBe(1);
  });
});
