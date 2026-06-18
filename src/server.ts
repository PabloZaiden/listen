import type { Server } from "bun";
import { posix as pathPosix } from "path";
import { initializeDatabase } from "./persistence/database";
import { handleApiRequest } from "./api";
import { websocketHandlers } from "./api/websocket";
import type { WebSocketData } from "./api/websocket/types";
import { readServerConfig, type ServerConfig } from "./core/server-config";
import { createLogger } from "./core/logger";
import webIndex from "./index.html";

const log = createLogger("server");

function getConfiguredWebDistDir(): string | undefined {
  const configuredDir = process.env["LISTEN_WEB_DIST_DIR"]?.trim();
  return configuredDir ? configuredDir.replace(/\/+$/, "") : undefined;
}

function getWebAssetPath(distDir: string, pathname: string): string {
  const normalizedPath = pathPosix.normalize(pathname === "/" ? "/index.html" : pathname);
  const segments = normalizedPath
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  return `${distDir}/${segments.join("/")}`;
}

function decodeWebPathname(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
}

export async function serveWebApp(req: Request): Promise<Response> {
  const distDir = getConfiguredWebDistDir();
  if (!distDir) {
    return new Response(webIndex.index, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const url = new URL(req.url);
  const decodedPathname = decodeWebPathname(url.pathname);
  if (decodedPathname === undefined) {
    return new Response("Malformed request path", { status: 400 });
  }

  const assetFile = Bun.file(getWebAssetPath(distDir, decodedPathname));
  if (await assetFile.exists()) {
    return new Response(assetFile);
  }

  const spaIndex = Bun.file(`${distDir}/index.html`);
  if (await spaIndex.exists()) {
    return new Response(spaIndex);
  }

  return new Response("Configured web dist is missing index.html.", { status: 500 });
}

export function getWebAppRoute(): typeof webIndex | typeof serveWebApp {
  return getConfiguredWebDistDir() ? serveWebApp : webIndex;
}

export function createFetchHandler(config: ServerConfig): (req: Request, server?: Server<WebSocketData>) => Promise<Response | undefined> {
  return async (req, server) => {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest(req, config, server);
    }
    return serveWebApp(req);
  };
}

export function startServer(config = readServerConfig()): Server<WebSocketData> {
  initializeDatabase(config.dataDir);
  log.info(`Listen server starting on ${config.host}:${config.port}`);
  if (config.sameOriginCheckDisabled) {
    log.warn("Same-origin protection is disabled");
  }
  return Bun.serve({
    hostname: config.host,
    port: config.port,
    routes: {
      "/api/*": (req, server) => handleApiRequest(req, config, server),
      "/*": getWebAppRoute(),
    },
    websocket: websocketHandlers,
    development: process.env["NODE_ENV"] !== "production",
  });
}
