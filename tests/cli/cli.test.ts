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

  test("help aliases and missing commands use the framework dispatcher", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await runMain([])).toBe(1);
      expect(await runMain(["help"])).toBe(0);
      expect(await runMain(["-h"])).toBe(0);
      expect(await runMain(["--help"])).toBe(0);

      expect(log).toHaveBeenCalledTimes(4);
      for (const [output] of log.mock.calls) {
        expect(output).toContain("Usage:");
      }
    } finally {
      log.mockRestore();
    }
  });

  test("unknown commands return an error and help", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await runMain(["unknown-command"])).toBe(1);
      expect(error).toHaveBeenCalledWith("Unknown command: unknown-command");
      expect(log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
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
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await runMain(["notify", "--title", "A", "--description", "B", "--markdown", "C"])).toBe(0);
      expect(await runMain(["notify", "--title=A", "--short-description=B", "--markdown=C"])).toBe(0);

      expect(receivedBodies).toEqual([
        { title: "A", shortDescription: "B", markdownContent: "C" },
        { title: "A", shortDescription: "B", markdownContent: "C" },
      ]);
    } finally {
      log.mockRestore();
    }
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

  test("update forwards check and version options through the public command", async () => {
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
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await runMain(["update", "--check", "--version=1.2.3"])).toBe(0);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/pablozaiden/listen/releases/tags/v1.2.3");
    } finally {
      fetch.mockRestore();
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
