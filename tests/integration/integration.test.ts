import "./../setup";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { startServer } from "../../src/server";
import { readServerConfig } from "../../src/core/server-config";
import { runConfigCommand } from "../../src/cli/config";
import { runNotifyCommand } from "../../src/cli/notify";

function expectSecurityHeaders(response: Response): void {
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
}

describe("integration", () => {
  test("CLI sends notification to running server with passkey disabled", async () => {
    const server = startServer({ ...readServerConfig(), host: "127.0.0.1", port: 0, passkeyDisabled: true, sameOriginCheckDisabled: true });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const sourceResponse = await fetch(`${base}/api/sources`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "CLI" }),
      });
      const source = await sourceResponse.json() as { webhookUrl: string };
      await runConfigCommand(["set-webhook-url", source.webhookUrl]);
      const notify = await runNotifyCommand(["--title", "Done", "--description", "Complete", "--markdown", "Finished"]);
      expect(notify.exitCode).toBe(0);
      const list = await fetch(`${base}/api/notifications`).then((response) => response.json()) as { notifications: Array<{ title: string }> };
      expect(list.notifications[0]?.title).toBe("Done");
    } finally {
      server.stop(true);
    }
  });

  test("serves source web app with security headers", async () => {
    const server = startServer({ ...readServerConfig(), host: "127.0.0.1", port: 0, passkeyDisabled: true, sameOriginCheckDisabled: true });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/`, { headers: { accept: "text/html" } });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expectSecurityHeaders(response);
      expect(await response.text()).toContain("<title>Listen</title>");

      const assetResponse = await fetch(`http://127.0.0.1:${server.port}/web/main.tsx`, { headers: { accept: "application/javascript" } });
      expect(assetResponse.status).toBe(200);
      expect(assetResponse.headers.get("content-type")).toContain("javascript");
      expectSecurityHeaders(assetResponse);
      expect(await assetResponse.text()).not.toContain("<title>Listen</title>");

      const stylesheetResponse = await fetch(`http://127.0.0.1:${server.port}/web/styles.css`, { headers: { accept: "text/css" } });
      expect(stylesheetResponse.status).toBe(200);
      expect(stylesheetResponse.headers.get("content-type")).toContain("text/css");
      expectSecurityHeaders(stylesheetResponse);
      expect(await stylesheetResponse.text()).not.toContain("<title>Listen</title>");
    } finally {
      server.stop(true);
    }
  });

  test("serves configured web dist without hiding missing assets or allowing traversal", async () => {
    const webRoot = mkdtempSync(join(tmpdir(), "listen-web-root-"));
    const distDir = join(webRoot, "dist");
    mkdirSync(distDir);
    writeFileSync(join(distDir, "index.html"), "<!doctype html><title>Listen dist</title><main>app shell</main>");
    writeFileSync(join(distDir, "app.js"), "console.log('listen');");
    writeFileSync(join(distDir, "service-worker"), "self.addEventListener('push', () => {});");
    writeFileSync(join(distDir, "manifest.webmanifest"), JSON.stringify({ name: "Listen", icons: [{ src: "/icons/listen-192.png" }] }));
    mkdirSync(join(distDir, "icons"));
    writeFileSync(join(distDir, "icons", "listen-192.png"), "png");
    writeFileSync(join(webRoot, "secret.txt"), "outside dist");
    process.env["LISTEN_WEB_DIST_DIR"] = distDir;

    const server = startServer({ ...readServerConfig(), host: "127.0.0.1", port: 0, passkeyDisabled: true, sameOriginCheckDisabled: true });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const rootResponse = await fetch(`${base}/`, { headers: { accept: "text/html" } });
      expect(rootResponse.status).toBe(200);
      expect(rootResponse.headers.get("content-type")).toContain("text/html");
      expectSecurityHeaders(rootResponse);
      expect(await rootResponse.text()).toContain("app shell");

      const assetResponse = await fetch(`${base}/app.js`, { headers: { accept: "application/javascript" } });
      expect(assetResponse.status).toBe(200);
      expect(assetResponse.headers.get("content-type")).toContain("javascript");
      expectSecurityHeaders(assetResponse);
      expect(await assetResponse.text()).toBe("console.log('listen');");

      const serviceWorkerResponse = await fetch(`${base}/service-worker`, { headers: { accept: "text/javascript" } });
      expect(serviceWorkerResponse.status).toBe(200);
      expect(serviceWorkerResponse.headers.get("content-type")).toContain("text/javascript");
      expect(serviceWorkerResponse.headers.get("service-worker-allowed")).toBe("/");
      expectSecurityHeaders(serviceWorkerResponse);
      expect(await serviceWorkerResponse.text()).toContain("addEventListener");

      const manifestResponse = await fetch(`${base}/manifest.webmanifest`, { headers: { accept: "application/manifest+json" } });
      expect(manifestResponse.status).toBe(200);
      expect(manifestResponse.headers.get("content-type")).toContain("application/manifest+json");
      expectSecurityHeaders(manifestResponse);
      expect(await manifestResponse.json()).toMatchObject({ name: "Listen" });

      const iconResponse = await fetch(`${base}/icons/listen-192.png`, { headers: { accept: "image/png" } });
      expect(iconResponse.status).toBe(200);
      expect(iconResponse.headers.get("content-type")).toContain("image/png");
      expect(await iconResponse.text()).toBe("png");

      const fallbackResponse = await fetch(`${base}/settings`, { headers: { accept: "text/html" } });
      expect(fallbackResponse.status).toBe(200);
      expect(fallbackResponse.headers.get("content-type")).toContain("text/html");
      expectSecurityHeaders(fallbackResponse);
      expect(await fallbackResponse.text()).toContain("app shell");

      const missingAssetResponse = await fetch(`${base}/missing.js`, { headers: { accept: "application/javascript" } });
      expect(missingAssetResponse.status).toBe(404);
      expectSecurityHeaders(missingAssetResponse);

      const malformedResponse = await fetch(`${base}/%E0%A4%A`, { headers: { accept: "text/html" } });
      expect(malformedResponse.status).toBe(400);
      expectSecurityHeaders(malformedResponse);

      const traversalResponse = await fetch(`${base}/%2e%2e/secret.txt`, { headers: { accept: "text/html" } });
      expect(traversalResponse.status).toBe(404);
      expectSecurityHeaders(traversalResponse);
      expect(await traversalResponse.text()).not.toBe("outside dist");
    } finally {
      server.stop(true);
      delete process.env["LISTEN_WEB_DIST_DIR"];
      rmSync(webRoot, { recursive: true, force: true });
    }
  });
});
