import type { Server } from "bun";
import { initializeDatabase } from "./persistence/database";
import { handleApiRequest } from "./api";
import { websocketHandlers } from "./api/websocket";
import type { WebSocketData } from "./api/websocket/types";
import { readServerConfig, type ServerConfig } from "./core/server-config";
import { createLogger } from "./core/logger";
import { getLogLevelPreference } from "./persistence/preferences";
import { isLogLevelFromEnv, setLogLevel } from "./core/logger";
import { withSecurityHeaders } from "./core/security-headers";
import { isServerDevelopmentMode } from "./core/runtime-mode";
import webIndex from "./index.html";
// @ts-expect-error Bun supports importing a TypeScript file as raw text with this import attribute.
import serviceWorkerSource from "./web/service-worker.ts" with { type: "text" };
import webManifest from "./web/manifest.webmanifest" with { type: "text" };
import listenIcon192Path from "./web/icons/listen-192.png" with { type: "file" };
import listenIcon512Path from "./web/icons/listen-512.png" with { type: "file" };
import appleTouchIconPath from "./web/icons/apple-touch-icon.png" with { type: "file" };

const log = createLogger("server");
const SERVICE_WORKER_PATH = "/service-worker";
const WEB_MANIFEST_PATH = "/manifest.webmanifest";
const serviceWorkerScript = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(serviceWorkerSource);
const WEB_ICON_PATHS = new Map([
  ["/icons/listen-192.png", listenIcon192Path],
  ["/icons/listen-512.png", listenIcon512Path],
  ["/icons/apple-touch-icon.png", appleTouchIconPath],
]);

function decodeWebPathname(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
}

function serviceWorkerHeaders(): HeadersInit {
  return {
    "content-type": "text/javascript; charset=utf-8",
    "service-worker-allowed": "/",
    "cache-control": "no-cache",
  };
}

function manifestHeaders(): HeadersInit {
  return {
    "content-type": "application/manifest+json; charset=utf-8",
  };
}

async function serveSourceServiceWorker(): Promise<Response> {
  return new Response(serviceWorkerScript, { headers: serviceWorkerHeaders() });
}

async function serveSourceWebAsset(pathname: string): Promise<Response | undefined> {
  if (pathname === SERVICE_WORKER_PATH) {
    return serveSourceServiceWorker();
  }
  if (pathname === WEB_MANIFEST_PATH) {
    return new Response(webManifest, { headers: manifestHeaders() });
  }
  const iconPath = WEB_ICON_PATHS.get(pathname);
  if (iconPath) {
    return new Response(Bun.file(iconPath), { headers: { "content-type": "image/png" } });
  }
  return undefined;
}

async function serveWebAppResponse(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const decodedPathname = decodeWebPathname(url.pathname);
  if (decodedPathname === undefined) {
    return new Response("Malformed request path", { status: 400 });
  }

  return await serveSourceWebAsset(decodedPathname)
    ?? new Response("Not found", { status: 404 });
}

export async function serveWebApp(req: Request): Promise<Response> {
  return withSecurityHeaders(await serveWebAppResponse(req));
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
  if (!isLogLevelFromEnv()) {
    const savedLogLevel = getLogLevelPreference();
    setLogLevel(savedLogLevel);
    log.debug("Log level set from saved preference", { level: savedLogLevel });
  } else {
    log.debug("Log level set from LISTEN_LOG_LEVEL environment variable");
  }
  log.info(`Listen server starting on ${config.host}:${config.port}`);
  if (config.sameOriginCheckDisabled) {
    log.warn("Same-origin protection is disabled");
  }
  return Bun.serve({
    hostname: config.host,
    port: config.port,
    routes: {
      "/api/*": (req, server) => handleApiRequest(req, config, server),
      [SERVICE_WORKER_PATH]: (req) => serveWebApp(req),
      [WEB_MANIFEST_PATH]: (req) => serveWebApp(req),
      "/icons/*": (req) => serveWebApp(req),
      "/*": webIndex,
    },
    websocket: websocketHandlers,
    development: isServerDevelopmentMode(),
  });
}
