import "./../setup";
import { describe, expect, test } from "bun:test";
import { createFetchHandler } from "../../src/server";
import { readServerConfig, type ServerConfig } from "../../src/core/server-config";
import { handleServerControl, scheduleServerShutdown } from "../../src/api/server-control";

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
});
