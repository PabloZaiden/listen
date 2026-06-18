import "./../setup";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { startServer } from "../../src/server";
import { readServerConfig } from "../../src/core/server-config";
import { runConfigCommand } from "../../src/cli/config";
import { runNotifyCommand } from "../../src/cli/notify";

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

  test("serves configured web dist without hiding missing assets or allowing traversal", async () => {
    const webRoot = mkdtempSync(join(tmpdir(), "listen-web-root-"));
    const distDir = join(webRoot, "dist");
    mkdirSync(distDir);
    writeFileSync(join(distDir, "index.html"), "<!doctype html><title>Listen dist</title><main>app shell</main>");
    writeFileSync(join(distDir, "app.js"), "console.log('listen');");
    writeFileSync(join(webRoot, "secret.txt"), "outside dist");
    process.env["LISTEN_WEB_DIST_DIR"] = distDir;

    const server = startServer({ ...readServerConfig(), host: "127.0.0.1", port: 0, passkeyDisabled: true, sameOriginCheckDisabled: true });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const assetResponse = await fetch(`${base}/app.js`, { headers: { accept: "application/javascript" } });
      expect(assetResponse.status).toBe(200);
      expect(await assetResponse.text()).toBe("console.log('listen');");

      const fallbackResponse = await fetch(`${base}/settings`, { headers: { accept: "text/html" } });
      expect(fallbackResponse.status).toBe(200);
      expect(await fallbackResponse.text()).toContain("app shell");

      const missingAssetResponse = await fetch(`${base}/missing.js`, { headers: { accept: "application/javascript" } });
      expect(missingAssetResponse.status).toBe(404);

      const malformedResponse = await fetch(`${base}/%E0%A4%A`, { headers: { accept: "text/html" } });
      expect(malformedResponse.status).toBe(400);

      const traversalResponse = await fetch(`${base}/%2e%2e/secret.txt`, { headers: { accept: "text/html" } });
      expect(traversalResponse.status).toBe(404);
      expect(await traversalResponse.text()).not.toBe("outside dist");
    } finally {
      server.stop(true);
      delete process.env["LISTEN_WEB_DIST_DIR"];
      rmSync(webRoot, { recursive: true, force: true });
    }
  });
});
