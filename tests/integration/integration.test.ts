import "./../setup";
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
});
