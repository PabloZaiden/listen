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
const SERVICE_WORKER_PATH = "/service-worker";
const WEB_MANIFEST_PATH = "/manifest.webmanifest";
const WEB_ICON_PATHS = new Set([
  "/icons/listen-192.png",
  "/icons/listen-512.png",
  "/icons/apple-touch-icon.png",
]);

function getConfiguredWebDistDir(): string | undefined {
  const configuredDir = process.env["LISTEN_WEB_DIST_DIR"]?.trim();
  return configuredDir ? configuredDir.replace(/\/+$/, "") : undefined;
}

function getWebAssetPath(distDir: string, pathname: string): string | undefined {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const requestedSegments = requestedPath.split("/").filter((segment) => segment.length > 0);
  if (requestedSegments.includes("..")) {
    return undefined;
  }

  const normalizedPath = pathPosix.normalize(requestedPath);
  const segments = normalizedPath
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  return `${distDir}/${segments.join("/")}`;
}

function acceptsHtml(req: Request): boolean {
  const accept = req.headers.get("accept");
  if (!accept) {
    return true;
  }

  return accept.split(",").some((part) => {
    const mimeType = part.split(";", 1)[0]?.trim().toLowerCase();
    return mimeType === "text/html" || mimeType === "application/xhtml+xml" || mimeType === "*/*";
  });
}

function looksLikeFileAsset(pathname: string): boolean {
  const lastSegment = pathname.split("/").filter((segment) => segment.length > 0).at(-1) ?? "";
  return /\.[^/.]+$/.test(lastSegment);
}

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

async function buildDevelopmentServiceWorker(): Promise<Response> {
  const result = await Bun.build({
    entrypoints: [`${import.meta.dir}/web/service-worker.ts`],
    minify: false,
    target: "browser",
  });
  if (!result.success) {
    log.error("Failed to build development service worker", { logs: result.logs });
    return new Response("Failed to build service worker", { status: 500 });
  }
  return new Response(await result.outputs[0]!.text(), { headers: serviceWorkerHeaders() });
}

async function serveSourceWebAsset(pathname: string): Promise<Response | undefined> {
  if (pathname === SERVICE_WORKER_PATH) {
    return buildDevelopmentServiceWorker();
  }
  if (pathname === WEB_MANIFEST_PATH) {
    return new Response(Bun.file(`${import.meta.dir}/web/manifest.webmanifest`), { headers: manifestHeaders() });
  }
  if (WEB_ICON_PATHS.has(pathname)) {
    return new Response(Bun.file(`${import.meta.dir}/web${pathname}`), { headers: { "content-type": "image/png" } });
  }
  return undefined;
}

async function serveDistWebAsset(distDir: string, pathname: string): Promise<Response | undefined> {
  if (pathname === SERVICE_WORKER_PATH) {
    const file = Bun.file(`${distDir}/service-worker`);
    return await file.exists() ? new Response(file, { headers: serviceWorkerHeaders() }) : undefined;
  }
  if (pathname === WEB_MANIFEST_PATH) {
    const file = Bun.file(`${distDir}/manifest.webmanifest`);
    return await file.exists() ? new Response(file, { headers: manifestHeaders() }) : undefined;
  }
  if (WEB_ICON_PATHS.has(pathname)) {
    const file = Bun.file(`${distDir}${pathname}`);
    return await file.exists() ? new Response(file, { headers: { "content-type": "image/png" } }) : undefined;
  }
  return undefined;
}

export async function serveWebApp(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const decodedPathname = decodeWebPathname(url.pathname);
  if (decodedPathname === undefined) {
    return new Response("Malformed request path", { status: 400 });
  }

  const distDir = getConfiguredWebDistDir();
  if (!distDir) {
    return await serveSourceWebAsset(decodedPathname)
      ?? new Response(webIndex.index, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const distAsset = await serveDistWebAsset(distDir, decodedPathname);
  if (distAsset) {
    return distAsset;
  }

  const assetPath = getWebAssetPath(distDir, decodedPathname);
  if (!assetPath) {
    return new Response("Not found", { status: 404 });
  }

  const assetFile = Bun.file(assetPath);
  if (await assetFile.exists()) {
    return new Response(assetFile);
  }

  if (!acceptsHtml(req) || looksLikeFileAsset(decodedPathname)) {
    return new Response("Not found", { status: 404 });
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
      [SERVICE_WORKER_PATH]: (req) => serveWebApp(req),
      [WEB_MANIFEST_PATH]: (req) => serveWebApp(req),
      "/icons/*": (req) => serveWebApp(req),
      "/*": getWebAppRoute(),
    },
    websocket: websocketHandlers,
    development: process.env["NODE_ENV"] !== "production",
  });
}
