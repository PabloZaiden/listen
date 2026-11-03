import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { sourceMutationResponseSchema, type NotificationDetail, type NotificationListItem, type SourceResponse } from "@listen/contracts";
import { WEBHOOK_JSON_BODY_MAX_BYTES } from "@listen/shared";
import { bootstrap, CookieJar, isolatedDirectory, login, RealtimeClient, removeDirectory, startApplication, type Application, type Distribution } from "../support/application";
import { legacyDataset } from "../support/legacy-dataset";
import { fixturePasskey, registrationResponse } from "../support/passkey";

interface NotificationPage {
  notifications: NotificationListItem[];
  unreadCount: number;
  pagination: { total: number; nextOffset?: number };
}
const message = { title: "Agent finished", shortDescription: "Ready for review", markdownContent: "## Done\n\n- Build passed" };

async function json<T>(response: Response, status = 200): Promise<T> {
  expect(response.status).toBe(status);
  return response.json() as Promise<T>;
}

async function list(app: Application, jar: CookieJar, query = ""): Promise<NotificationPage> {
  return json<NotificationPage>(await app.request(`/api/notifications${query}`, {}, jar));
}

describe("single-account web application", () => {
  for (const distribution of (process.env["LISTEN_TEST_IMAGE"] ? ["compiled", "container"] : ["compiled"]) as Distribution[]) {
  test(`boots privately, enrolls a passkey, synchronizes inbox/source changes and retains sessions across restart (${distribution})`, async () => {
    const directory = isolatedDirectory();
    let app: Application | undefined;
    let realtime: RealtimeClient | undefined;
    try {
      app = await startApplication(directory, 0, distribution);
      expect((await app.request("/api/sources")).status).toBe(401);
      expect((await app.request("/api/account")).status).toBe(200);
      expect((await app.request("/api/account/bootstrap/options", {
        method: "POST", headers: { origin: "https://untrusted.invalid" }, body: JSON.stringify({ username: "owner" }),
      })).status).toBe(403);
      const jar = new CookieJar();
      const key = await bootstrap(app, jar);
      const source = sourceMutationResponseSchema.parse(await json(await app.request("/api/sources", {
        method: "POST", body: JSON.stringify({ name: "Coding Agent" }),
      }, jar), 201));
      expect(source.webhookUrl.startsWith(app.baseUrl)).toBe(true);
      realtime = new RealtimeClient(app, jar);
      await realtime.subscribe();
      const malformed = await app.request(new URL(source.webhookUrl).pathname, { method: "POST", body: JSON.stringify({ ...message, source: "spoofed" }) });
      expect(malformed.status).toBe(400);
      expect((await app.request(new URL(source.webhookUrl).pathname, {
        method: "POST", body: JSON.stringify({ ...message, markdownContent: "x".repeat(WEBHOOK_JSON_BODY_MAX_BYTES) }),
      })).status).toBe(413);
      const created = await json<{ id: string }>(await app.request(new URL(source.webhookUrl).pathname, { method: "POST", body: JSON.stringify(message) }), 201);
      const changed = await realtime.wait(frame => frame["type"] === "event" && (frame["event"] as { resource?: string; id?: string }).resource === "notifications");
      expect(changed["event"]).toMatchObject({ resource: "notifications", id: created.id });
      const first = await list(app, jar, "?limit=1");
      expect(first.notifications).toMatchObject([{ id: created.id, title: message.title, source: "Coding Agent", sourceId: source.source.id }]);
      expect(first.unreadCount).toBe(1);
      const detail = await json<{ notification: NotificationDetail }>(await app.request(`/api/notifications/${created.id}`, {}, jar));
      expect(detail.notification.markdownContent).toBe(message.markdownContent);
      expect(detail.notification.readAt).toBeTruthy();
      expect((await json<{ notification: NotificationDetail }>(await app.request(`/api/notifications/${created.id}`, {}, jar))).notification.readAt).toBe(detail.notification.readAt);
      expect((await list(app, jar)).unreadCount).toBe(0);
      await json(await app.request(`/api/notifications/${created.id}/unread`, { method: "POST" }, jar));
      expect((await list(app, jar, "?read=false")).notifications.map(item => item.id)).toEqual([created.id]);
      await json(await app.request(new URL(source.webhookUrl).pathname, { method: "POST", body: JSON.stringify({ ...message, title: "Another" }) }), 201);
      const page = await list(app, jar, "?limit=1");
      expect(page.pagination.nextOffset).toBe(1);
      expect((await list(app, jar, "?limit=1&offset=1")).notifications).toHaveLength(1);
      expect((await app.request("/api/notifications?limit=invalid", {}, jar)).status).toBe(400);
      await json(await app.request("/api/notifications/read", { method: "POST" }, jar));
      expect((await list(app, jar)).unreadCount).toBe(0);
      await json(await app.request("/api/account/theme", { method: "PUT", body: JSON.stringify({ theme: "light" }) }, jar));
      const vapid = await json<{ publicKey: string }>(await app.request("/api/browser-push/config", {}, jar));
      const endpoint = "https://push.invalid/fresh";
      await json(await app.request("/api/browser-push/subscriptions", { method: "POST", body: JSON.stringify({
        subscription: { endpoint, expirationTime: 1, keys: { p256dh: "fixture-p256dh", auth: "fixture-auth" } },
      }) }, jar), 201);
      expect(await json(await app.request("/api/browser-push/subscriptions/lookup", { method: "POST", body: JSON.stringify({ endpoint }) }, jar))).toEqual({ subscribed: true });

      for (const [path, contentType] of [["/", "text/html"], ["/site.webmanifest", "application/manifest+json"], ["/service-worker", "javascript"], ["/webapp-favicon.svg", "image/svg+xml"], ["/webapp-icon-1.png", "image/png"]]) {
        const response = await app.request(path!);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain(contentType!);
      }
      realtime.close();
      const port = Number(new URL(app.baseUrl).port);
      await app.stop();
      app = await startApplication(directory, port, distribution);
      expect((await list(app, jar)).pagination.total).toBe(2);
      expect(await json(await app.request("/api/account", {}, jar))).toMatchObject({ authenticated: true, theme: "light" });
      expect((await json<{ publicKey: string }>(await app.request("/api/browser-push/config", {}, jar))).publicKey).toBe(vapid.publicKey);
      const loggedOutCookie = jar.header();
      await json(await app.request("/api/account/logout", { method: "POST" }, jar));
      expect((await app.request("/api/sources", { headers: { cookie: loggedOutCookie } })).status).toBe(401);
      expect((await login(app, jar, key)).status).toBe(200);

      const otherJar = new CookieJar();
      expect((await login(app, otherJar, key)).status).toBe(200);
      const replacement = fixturePasskey();
      const { challengeId, options } = await json<{ challengeId: string; options: { challenge: string; rp: { id?: string } } }>(await app.request("/api/account/passkey/options", { method: "POST" }, jar));
      const response = registrationResponse(replacement, options, app.baseUrl);
      replacement.id = response.id;
      await json(await app.request("/api/account/passkey/verify", { method: "POST", body: JSON.stringify({ challengeId, response }) }, jar));
      expect((await app.request("/api/sources", {}, otherJar)).status).toBe(401);
      expect((await login(app, new CookieJar(), key)).status).toBe(401);
      expect((await login(app, new CookieJar(), replacement)).status).toBe(200);
      const rotated = sourceMutationResponseSchema.parse(await json(await app.request(`/api/sources/${source.source.id}/token/rotate`, { method: "POST" }, jar)));
      expect((await app.request(new URL(source.webhookUrl).pathname, { method: "POST", body: JSON.stringify(message) })).status).toBe(401);
      await json(await app.request(new URL(rotated.webhookUrl).pathname, { method: "POST", body: JSON.stringify(message) }), 201);
      await json(await app.request(`/api/sources/${source.source.id}`, { method: "DELETE" }, jar));
      expect((await list(app, jar)).pagination.total).toBe(0);
      expect((await app.request(new URL(rotated.webhookUrl).pathname, { method: "POST", body: JSON.stringify(message) })).status).toBe(404);
    } finally {
      realtime?.close();
      await app?.stop();
      removeDirectory(directory);
    }
  }, 120_000);
  }

  test("upgrades all legacy inboxes once, preserves owner access and webhooks, and restores the private backup", async () => {
    const directory = isolatedDirectory();
    const restored = isolatedDirectory();
    const legacy = await legacyDataset(directory);
    let app: Application | undefined;
    let realtime: RealtimeClient | undefined;
    try {
      app = await startApplication(directory);
      legacy.close();
      expect((await app.request("/api/sources", { headers: { cookie: legacy.oldCookie } })).status).toBe(401);
      expect((await app.request("/api/sources", { headers: { authorization: `Bearer ${legacy.oldApiToken}` } })).status).toBe(401);
      expect((await login(app, new CookieJar(), legacy.otherPasskey)).status).toBe(401);
      const jar = new CookieJar();
      expect((await login(app, jar, legacy.ownerPasskey)).status).toBe(200);
      expect(await json(await app.request("/api/account", {}, jar))).toMatchObject({ authenticated: true, owner: { username: "owner" }, theme: "light" });
      const sources = await json<{ sources: SourceResponse[] }>(await app.request("/api/sources", {}, jar));
      expect(sources.sources.map(source => source.id).sort()).toEqual(legacy.sources.map(source => source.id).sort());
      const migrated = await list(app, jar);
      expect(migrated.pagination.total).toBe(3);
      expect(migrated.unreadCount).toBe(1);
      for (let index = 0; index < 3; index++) {
        expect(migrated.notifications.find(item => item.id === `notification-${index}`)).toMatchObject({
          sourceId: `source-${index}`, createdAt: "2026-10-01T10:00:00.000Z",
          ...(index === 1 ? {} : { readAt: legacy.readAt }),
        });
      }
      expect((await json<{ publicKey: string }>(await app.request("/api/browser-push/config", {}, jar))).publicKey).toBe(legacy.vapidPublicKey);
      for (const [user, subscribed] of [["owner", true], ["member", false]] as const) {
        expect(await json(await app.request("/api/browser-push/subscriptions/lookup", {
          method: "POST", body: JSON.stringify({ endpoint: `https://push.invalid/${user}` }),
        }, jar))).toEqual({ subscribed });
      }
      realtime = new RealtimeClient(app, jar);
      await realtime.subscribe();
      const webhookPath = `/api/webhooks/${legacy.sources[1]!.id}/${legacy.sources[1]!.token}`;
      const delivery = await json<{ id: string }>(await app.request(webhookPath, { method: "POST", body: JSON.stringify(message) }), 201);
      await realtime.wait(frame => frame["type"] === "event" && (frame["event"] as { id?: string }).id === delivery.id);
      expect((await list(app, jar)).pagination.total).toBe(4);
      const backupDir = join(directory, "backups");
      const backupPath = join(backupDir, "listen.pre-single-account.db");
      expect(statSync(backupPath).mode & 0o777).toBe(0o600);
      const backupBytes = await Bun.file(backupPath).bytes();
      const port = Number(new URL(app.baseUrl).port);
      realtime.close();
      await app.stop();
      app = await startApplication(directory, port);
      expect((await list(app, jar)).pagination.total).toBe(4);
      expect(readdirSync(backupDir)).toEqual(["listen.pre-single-account.db"]);
      expect(await Bun.file(backupPath).bytes()).toEqual(backupBytes);
      await json(await app.request("/api/sources/source-1", { method: "DELETE" }, jar));
      expect((await list(app, jar)).pagination.total).toBe(2);
      await app.stop();

      copyFileSync(backupPath, join(restored, "listen.db"));
      app = await startApplication(restored);
      const restoredJar = new CookieJar();
      legacy.ownerPasskey.counter = 0;
      expect((await login(app, restoredJar, legacy.ownerPasskey)).status).toBe(200);
      expect((await list(app, restoredJar)).pagination.total).toBe(3);
      await json(await app.request(webhookPath, { method: "POST", body: JSON.stringify(message) }), 201);
      expect((await list(app, restoredJar)).pagination.total).toBe(4);
    } finally {
      realtime?.close();
      await app?.stop();
      legacy.close();
      removeDirectory(directory);
      removeDirectory(restored);
    }
  }, 120_000);

  test("refuses ambiguous legacy ownership and an unavailable create-only backup before serving", async () => {
    for (const state of ["missing", "ambiguous"] as const) {
      const directory = isolatedDirectory();
      const legacy = await legacyDataset(directory, state);
      legacy.close();
      try {
        await expect(startApplication(directory)).rejects.toThrow("Cannot migrate Listen");
      } finally { removeDirectory(directory); }
    }
    const directory = isolatedDirectory();
    const legacy = await legacyDataset(directory);
    legacy.close();
    try {
      mkdirSync(join(directory, "backups"), { recursive: true });
      await Bun.write(join(directory, "backups/listen.pre-single-account.db"), "operator recovery copy");
      await expect(startApplication(directory)).rejects.toThrow();
      expect(await Bun.file(join(directory, "backups/listen.pre-single-account.db")).text()).toBe("operator recovery copy");
    } finally { removeDirectory(directory); }
  }, 120_000);
});
