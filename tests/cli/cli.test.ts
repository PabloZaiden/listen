import "./../setup";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { configPath, readConfig, runConfigCommand } from "../../src/cli/config";
import { runNotifyCommand } from "../../src/cli/notify";

describe("CLI", () => {
  test("config set/show/clear manages ~/.listen/config.json", async () => {
    const set = await runConfigCommand(["set-webhook-url", "https://listen.example.com/api/webhooks/source/token"]);
    expect(set.exitCode).toBe(0);
    expect(existsSync(configPath())).toBe(true);
    expect((await readConfig())?.webhookUrl).toBe("https://listen.example.com/api/webhooks/source/token");
    const show = await runConfigCommand(["show"]);
    expect(show.output).toContain("webhookUrl");
    const clear = await runConfigCommand(["clear"]);
    expect(clear.exitCode).toBe(0);
  });

  test("missing notify fields fail", async () => {
    process.env["LISTEN_WEBHOOK_URL"] = "https://listen.example.com/api/webhooks/source/token";
    const result = await runNotifyCommand(["--title", "A"]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Require exactly one");
  });

  test("LISTEN_WEBHOOK_URL override is used for notify", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const body = await req.json() as { title: string; shortDescription: string; markdownContent: string };
        expect(body).toEqual({ title: "A", shortDescription: "B", markdownContent: "C" });
        return Response.json({ id: "notification-id" }, { status: 201 });
      },
    });
    process.env["LISTEN_WEBHOOK_URL"] = `http://127.0.0.1:${server.port}/webhook`;
    const result = await runNotifyCommand(["--title", "A", "--description", "B", "--markdown", "C"]);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("notification-id");
  });
});
