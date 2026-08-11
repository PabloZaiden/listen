import "./../setup";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../../package.json";
import { configPath, readConfig, readHomeConfig, runConfigCommand, setBinaryConfigPathForTests } from "../../src/cli/config";
import { runNotifyCommand } from "../../src/cli/notify";
import { createListenCli } from "../../src/cli";

async function executeCli(args: string[]) {
  return await createListenCli().execute(args);
}

describe("CLI", () => {
  afterEach(() => {
    setBinaryConfigPathForTests();
    delete process.env["LISTEN_WEBHOOK_URL"];
  });

  test("composes framework commands with Listen-owned extensions", () => {
    const cli = createListenCli();

    for (const command of ["help", "serve", "version", "update", "logs", "api", "schema", "auth", "status", "profile", "ws"]) {
      expect(cli.commands[command]).toBeDefined();
    }
    expect(cli.commands["config"]?.override).toBe(true);
    expect(cli.commands["notify"]).toBeDefined();
    expect(cli.help("config")).toContain("set-webhook-url");
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
    const result = await executeCli(["version"]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe(packageJson.version);
  });

  test("help aliases and missing commands use the framework dispatcher", async () => {
    expect((await executeCli([])).exitCode).toBe(1);
    expect((await executeCli(["help"])).exitCode).toBe(0);
    expect((await executeCli(["-h"])).exitCode).toBe(0);
    expect((await executeCli(["--help"])).exitCode).toBe(0);

    for (const args of [[], ["help"], ["-h"], ["--help"]]) {
      expect((await executeCli(args)).output).toContain("Usage:");
    }
  });

  test("unknown commands return an error and help", async () => {
    const result = await executeCli(["unknown-command"]);

    expect(result.exitCode).toBe(1);
    expect(result.error).toBe("Unknown command: unknown-command");
    expect(result.output).toContain("Usage:");
  });

  test("dispatches notify arguments after the command name", async () => {
    const receivedBodies: unknown[] = [];
    using server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBodies.push(await req.json());
        return Response.json({ id: "notification-id" }, { status: 201 });
      },
    });
    process.env["LISTEN_WEBHOOK_URL"] = `http://127.0.0.1:${server.port}/webhook`;
    expect((await executeCli(["notify", "--title", "A", "--description", "B", "--markdown", "C"])).exitCode).toBe(0);
    expect((await executeCli(["notify", "--title=A", "--short-description=B", "--markdown=C"])).exitCode).toBe(0);

    expect(receivedBodies).toEqual([
      { title: "A", shortDescription: "B", markdownContent: "C" },
      { title: "A", shortDescription: "B", markdownContent: "C" },
    ]);
  });

  test("notify supports markdown-file and rejects multiple markdown sources", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "listen-markdown-"));
    const markdownPath = join(tempDir, "message.md");
    writeFileSync(markdownPath, "Markdown from a file");
    let receivedBody: unknown;
    using server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBody = await req.json();
        return Response.json({ id: "notification-id" }, { status: 201 });
      },
    });
    process.env["LISTEN_WEBHOOK_URL"] = `http://127.0.0.1:${server.port}/webhook`;
    try {
      const valid = await runNotifyCommand([
        "--title=A",
        "--short-description=B",
        `--markdown-file=${markdownPath}`,
      ]);
      expect(valid.exitCode).toBe(0);
      expect(receivedBody).toEqual({
        title: "A",
        shortDescription: "B",
        markdownContent: "Markdown from a file",
      });

      const invalid = await runNotifyCommand([
        "--title",
        "A",
        "--description",
        "B",
        "--markdown=C",
        `--markdown-file=${markdownPath}`,
      ]);
      expect(invalid.exitCode).toBe(1);
      expect(invalid.error).toContain("Require exactly one");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("update forwards the public check option through the framework command", async () => {
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        tag_name: "v1.2.3",
        assets: [
          { name: "listen-v1.2.3-linux-x64", browser_download_url: "https://example.com/listen-linux-x64" },
          { name: "listen-v1.2.3-linux-arm64", browser_download_url: "https://example.com/listen-linux-arm64" },
          { name: "listen-v1.2.3-darwin-x64", browser_download_url: "https://example.com/listen-darwin-x64" },
          { name: "listen-v1.2.3-darwin-arm64", browser_download_url: "https://example.com/listen-darwin-arm64" },
        ],
      }),
    );
    try {
      const result = await executeCli(["update", "--check"]);

      expect(result.exitCode).toBe(0);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/pablozaiden/listen/releases/latest");
    } finally {
      fetch.mockRestore();
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

  test("notify request failures do not echo webhook credentials", async () => {
    const token = "secret-token";
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("request rejected", { status: 500 }),
    });
    process.env["LISTEN_WEBHOOK_URL"] = `http://127.0.0.1:${server.port}/api/webhooks/source/${token}`;

    const result = await runNotifyCommand(["--title", "A", "--description", "B", "--markdown", "C"]);

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("status 500");
    expect(result.error).not.toContain(token);
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
