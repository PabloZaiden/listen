import "./../setup";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../../package.json";
import { configPath, readConfig, readHomeConfig, runConfigCommand, setBinaryConfigPathForTests } from "../../src/cli/config";
import { runNotifyCommand } from "../../src/cli/notify";
import { runMain } from "../../src/entrypoint";

describe("CLI", () => {
  afterEach(() => {
    setBinaryConfigPathForTests();
    delete process.env["LISTEN_WEBHOOK_URL"];
  });

  test("config set/show/clear manages ~/.listen/config.json", async () => {
    const set = await runConfigCommand(["set-webhook-url", "https://listen.example.com/api/webhooks/source/token"]);
    expect(set.exitCode).toBe(0);
    expect(existsSync(configPath())).toBe(true);
    expect((await readConfig())?.webhookUrl).toBe("https://listen.example.com/api/webhooks/source/token");
    expect((await readHomeConfig())?.webhookUrl).toBe("https://listen.example.com/api/webhooks/source/token");
    const show = await runConfigCommand(["show"]);
    expect(show.output).toContain("webhookUrl");
    const clear = await runConfigCommand(["clear"]);
    expect(clear.exitCode).toBe(0);
  });

  test("version command prints the package version", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      const exitCode = await runMain(["version"]);

      expect(exitCode).toBe(0);
      expect(log).toHaveBeenCalledWith(packageJson.version);
    } finally {
      log.mockRestore();
    }
  });

  test("read config prefers listen.config.json beside the binary", async () => {
    const binaryDir = mkdtempSync(join(tmpdir(), "listen-binary-"));
    const binaryConfigPath = join(binaryDir, "listen.config.json");
    setBinaryConfigPathForTests(binaryConfigPath);
    try {
      const set = await runConfigCommand(["set-webhook-url", "https://listen.example.com/api/webhooks/home/token"]);
      expect(set.exitCode).toBe(0);
      writeFileSync(binaryConfigPath, `${JSON.stringify({ webhookUrl: "https://listen.example.com/api/webhooks/binary/token" }, null, 2)}\n`, { mode: 0o600 });

      expect((await readConfig())?.webhookUrl).toBe("https://listen.example.com/api/webhooks/binary/token");
      expect((await readHomeConfig())?.webhookUrl).toBe("https://listen.example.com/api/webhooks/home/token");
      const show = await runConfigCommand(["show"]);
      expect(show.output).toContain("/binary/token");
    } finally {
      rmSync(binaryDir, { recursive: true, force: true });
    }
  });

  test("config set writes to home even when binary config exists", async () => {
    const binaryDir = mkdtempSync(join(tmpdir(), "listen-binary-"));
    const binaryConfigPath = join(binaryDir, "listen.config.json");
    setBinaryConfigPathForTests(binaryConfigPath);
    try {
      writeFileSync(binaryConfigPath, `${JSON.stringify({ webhookUrl: "https://listen.example.com/api/webhooks/binary/token" }, null, 2)}\n`, { mode: 0o600 });
      const set = await runConfigCommand(["set-webhook-url", "https://listen.example.com/api/webhooks/home/token"]);

      expect(set.exitCode).toBe(0);
      expect((await readConfig())?.webhookUrl).toBe("https://listen.example.com/api/webhooks/binary/token");
      expect((await readHomeConfig())?.webhookUrl).toBe("https://listen.example.com/api/webhooks/home/token");
    } finally {
      rmSync(binaryDir, { recursive: true, force: true });
    }
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

  test("inline notify converts escaped newlines before delivery", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const body = await req.json() as { title: string; shortDescription: string; markdownContent: string };
        expect(body).toEqual({
          title: "A",
          shortDescription: "B",
          markdownContent: "Line one\n\n- item",
        });
        return Response.json({ id: "notification-id" }, { status: 201 });
      },
    });
    process.env["LISTEN_WEBHOOK_URL"] = `http://127.0.0.1:${server.port}/webhook`;

    const result = await runNotifyCommand([
      "--title",
      "A",
      "--description",
      "B",
      "--markdown",
      "Line one\\n\\n- item",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("notification-id");
  });
});
