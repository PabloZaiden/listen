import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { accountStatusResponseSchema } from "@listen/contracts";
import { authenticationResponse, fixturePasskey, registrationResponse, type FixturePasskey } from "./passkey";

export class CookieJar {
  private cookies = new Map<string, string>();
  absorb(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";", 1)[0]!;
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
  }
  header(): string { return Array.from(this.cookies, ([key, value]) => `${key}=${value}`).join("; "); }
}

export function isolatedDirectory(): string {
  mkdirSync(".cache/tests", { recursive: true });
  return mkdtempSync(join(process.cwd(), ".cache/tests/journey-"));
}

export interface Application {
  baseUrl: string;
  request(path: string, init?: RequestInit, jar?: CookieJar): Promise<Response>;
  stop(): Promise<void>;
}

const volumes = new Map<string, string>();
export type Distribution = "compiled" | "container";

export async function startApplication(directory: string, requestedPort = 0, distribution: Distribution = "compiled"): Promise<Application> {
  const reservation = Bun.serve({ hostname: "localhost", port: requestedPort, fetch: () => new Response() });
  const port = reservation.port!;
  await reservation.stop(true);
  const home = join(directory, "home");
  mkdirSync(home, { recursive: true });
  const image = process.env["LISTEN_TEST_IMAGE"];
  const containerName = `listen-test-${crypto.randomUUID()}`;
  let command = [process.env["LISTEN_TEST_EXECUTABLE"] ?? join(process.cwd(), "dist/listen")];
  if (distribution === "container") {
    if (!image) throw new Error("LISTEN_TEST_IMAGE is required for container validation");
    let volume = volumes.get(directory);
    if (!volume) {
      volume = `listen-test-${crypto.randomUUID()}`;
      const created = Bun.spawnSync(["docker", "volume", "create", volume]);
      if (created.exitCode !== 0) throw new Error("Could not create the isolated Listen test volume");
      volumes.set(directory, volume);
    }
    command = ["docker", "run", "--rm", "--name", containerName, "-p", `127.0.0.1:${port}:8080`,
      "--mount", `type=volume,src=${volume},dst=/app/data`, "-e", `LISTEN_PUBLIC_BASE_URL=http://localhost:${port}`,
      "-e", "LISTEN_TRUST_PROXY=false", image];
  }
  const child = Bun.spawn({
    cmd: command,
    env: {
      ...process.env, HOME: home, LISTEN_DATA_DIR: directory, LISTEN_HOST: "localhost", LISTEN_PORT: String(port),
      LISTEN_PUBLIC_BASE_URL: `http://localhost:${port}`, LISTEN_TRUST_PROXY: "false",
      LISTEN_DISABLE_PASSKEY: "", LISTEN_DISABLE_SAME_ORIGIN_CHECK: "", LISTEN_LOG_LEVEL: "error",
    },
    stdout: "pipe", stderr: "pipe",
  });
  const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const baseUrl = `http://localhost:${port}`;
  let stopped = false;
  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    if (distribution === "container") {
      const stop = Bun.spawn(["docker", "stop", "--time", "5", containerName], { stdout: "ignore", stderr: "ignore" });
      await stop.exited;
    } else if (child.exitCode === null) child.kill("SIGTERM");
    const timer = setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 5000);
    try { await child.exited; await output; } finally { clearTimeout(timer); }
  }
  const until = Date.now() + 10_000;
  while (Date.now() < until && child.exitCode === null) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return {
        baseUrl,
        async request(path, init = {}, jar) {
          const headers = new Headers(init.headers);
          if (!headers.has("origin")) headers.set("origin", baseUrl);
          if (jar) headers.set("cookie", jar.header());
          if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
          const response = await fetch(new URL(path, baseUrl), { ...init, headers, signal: init.signal ?? AbortSignal.timeout(5000) });
          jar?.absorb(response);
          return response;
        },
        stop,
      };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
    await Bun.sleep(20);
  }
  await stop();
  throw new Error(`Listen did not start: ${(await output).join("\n")}`);
}

export async function bootstrap(app: Application, jar: CookieJar): Promise<FixturePasskey> {
  const begin = await app.request("/api/account/bootstrap/options", { method: "POST", body: JSON.stringify({ username: "owner" }) }, jar);
  if (!begin.ok) throw new Error(`Bootstrap options failed (${begin.status})`);
  const { challengeId, options } = await begin.json() as { challengeId: string; options: { challenge: string; rp: { id?: string } } };
  const key = fixturePasskey();
  const response = registrationResponse(key, options, app.baseUrl);
  key.id = response.id;
  const finish = await app.request("/api/account/bootstrap/verify", { method: "POST", body: JSON.stringify({ challengeId, response }) }, jar);
  if (!finish.ok) throw new Error(`Bootstrap verification failed (${finish.status}): ${await finish.text()}`);
  accountStatusResponseSchema.parse(await finish.json());
  return key;
}

export async function login(app: Application, jar: CookieJar, key: FixturePasskey): Promise<Response> {
  const begin = await app.request("/api/account/login/options", { method: "POST" }, jar);
  if (!begin.ok) throw new Error(`Login options failed (${begin.status})`);
  const { challengeId, options } = await begin.json() as { challengeId: string; options: { challenge: string; rpId?: string } };
  return app.request("/api/account/login/verify", {
    method: "POST", body: JSON.stringify({ challengeId, response: authenticationResponse(key, options, app.baseUrl) }),
  }, jar);
}

export class RealtimeClient {
  readonly socket: WebSocket;
  private frames: Array<Record<string, unknown>> = [];
  private listeners = new Set<() => void>();
  constructor(app: Application, jar: CookieJar) {
    const BunWebSocket = WebSocket as unknown as { new(url: string, options: Bun.WebSocketOptions): WebSocket };
    this.socket = new BunWebSocket(app.baseUrl.replace("http:", "ws:") + "/api/ws", { headers: { cookie: jar.header(), origin: app.baseUrl } });
    this.socket.addEventListener("message", (event) => {
      this.frames.push(JSON.parse(String(event.data)) as Record<string, unknown>);
      for (const listener of this.listeners) listener();
    });
  }
  async subscribe(): Promise<void> {
    if (this.socket.readyState !== WebSocket.OPEN) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Realtime open timed out")), 5000);
      this.socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Realtime authentication failed")); }, { once: true });
    });
    this.socket.send(JSON.stringify({ type: "subscribe", subscriptionId: "inbox", generation: 1, interest: { kinds: ["state"], resources: ["notifications", "sources"] } }));
    await this.wait(frame => frame["type"] === "subscribed");
  }
  async wait(predicate: (frame: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.listeners.delete(check); reject(new Error("Realtime frame timed out")); }, 5000);
      const check = () => {
        const index = this.frames.findIndex(predicate);
        if (index >= 0) {
          clearTimeout(timer);
          this.listeners.delete(check);
          resolve(this.frames.splice(index, 1)[0]!);
        }
      };
      this.listeners.add(check);
      check();
    });
  }
  close(): void { this.socket.close(); }
}

export function removeDirectory(directory: string): void {
  const volume = volumes.get(directory);
  if (volume) {
    const removed = Bun.spawnSync(["docker", "volume", "rm", volume]);
    if (removed.exitCode !== 0) throw new Error("Could not remove the isolated Listen test volume");
    volumes.delete(directory);
  }
  rmSync(directory, { recursive: true, force: true });
}
