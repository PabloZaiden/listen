import type { Server } from "bun";
import { posix as pathPosix } from "path";
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

const log = createLogger("server");
const SERVICE_WORKER_PATH = "/service-worker";
const WEB_MANIFEST_PATH = "/manifest.webmanifest";
const SOURCE_WEB_MAIN_PATH = "/web/main.tsx";
const SOURCE_WEB_STYLES_PATH = "/web/styles.css";
const WEB_ICON_PATHS = new Set([
  "/icons/listen-192.png",
  "/icons/listen-512.png",
  "/icons/apple-touch-icon.png",
]);

interface FetchableHtmlBundle {
  fetch?: (req: Request) => Response | Promise<Response>;
}

interface SourceWebBuild {
  index: Bun.BuildArtifact;
  assets: Map<string, Bun.BuildArtifact>;
}

const sourceWebBundle = webIndex as typeof webIndex & FetchableHtmlBundle;
let sourceWebBuildPromise: Promise<SourceWebBuild> | undefined;

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

function webDistFileHeaders(filePath: string): HeadersInit {
  const extension = pathPosix.extname(filePath).toLowerCase();
  const contentType = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
  }[extension];

  return contentType ? { "content-type": contentType } : {};
}

async function serveSourceServiceWorker(): Promise<Response> {
  return new Response(Bun.file(`${import.meta.dir}/web/service-worker.ts`), { headers: serviceWorkerHeaders() });
}

async function serveSourceWebAsset(pathname: string): Promise<Response | undefined> {
  if (pathname === SERVICE_WORKER_PATH) {
    return serveSourceServiceWorker();
  }
  if (pathname === WEB_MANIFEST_PATH) {
    return new Response(Bun.file(`${import.meta.dir}/web/manifest.webmanifest`), { headers: manifestHeaders() });
  }
  if (WEB_ICON_PATHS.has(pathname)) {
    return new Response(Bun.file(`${import.meta.dir}/web${pathname}`), { headers: { "content-type": "image/png" } });
  }
  return undefined;
}

function responseFromBuildArtifact(artifact: Bun.BuildArtifact): Response {
  return new Response(artifact, { headers: { "content-type": artifact.type } });
}

function normalizeBuildOutputPath(outputPath: string): string {
  const withoutCurrentDir = outputPath.replace(/^\.\//, "");
  return withoutCurrentDir.startsWith("/") ? withoutCurrentDir : `/${withoutCurrentDir}`;
}

async function buildSourceWebApp(): Promise<SourceWebBuild> {
  const result = await Bun.build({
    entrypoints: [webIndex.index],
    publicPath: "/",
    target: "browser",
  });
  if (!result.success) {
    throw new Error(`Source web app build failed: ${result.logs.map((entry) => entry.message).join("; ")}`);
  }

  const assets = new Map<string, Bun.BuildArtifact>();
  let index: Bun.BuildArtifact | undefined;
  let mainScript: Bun.BuildArtifact | undefined;
  let stylesheet: Bun.BuildArtifact | undefined;
  for (const output of result.outputs) {
    const outputPath = normalizeBuildOutputPath(output.path);
    if (outputPath === "/index.html") {
      index = output;
    } else {
      assets.set(outputPath, output);
      if (!mainScript && output.type.startsWith("text/javascript")) {
        mainScript = output;
      }
      if (!stylesheet && output.type.startsWith("text/css")) {
        stylesheet = output;
      }
    }
  }

  if (!index) {
    throw new Error("Source web app build did not produce index.html");
  }
  if (mainScript) {
    assets.set(SOURCE_WEB_MAIN_PATH, mainScript);
  }
  if (stylesheet) {
    assets.set(SOURCE_WEB_STYLES_PATH, stylesheet);
  }
  return { index, assets };
}

function getSourceWebBuild(): Promise<SourceWebBuild> {
  sourceWebBuildPromise ??= buildSourceWebApp();
  return sourceWebBuildPromise;
}

async function serveSourceWebBundle(req: Request, pathname: string): Promise<Response> {
  const fetch = sourceWebBundle.fetch;
  if (fetch) {
    return fetch(req);
  }

  const build = await getSourceWebBuild();
  const asset = build.assets.get(pathname);
  if (asset) {
    return responseFromBuildArtifact(asset);
  }
  if (!acceptsHtml(req) || looksLikeFileAsset(pathname)) {
    return new Response("Not found", { status: 404 });
  }
  return responseFromBuildArtifact(build.index);
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

async function serveWebAppResponse(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const decodedPathname = decodeWebPathname(url.pathname);
  if (decodedPathname === undefined) {
    return new Response("Malformed request path", { status: 400 });
  }

  const distDir = getConfiguredWebDistDir();
  if (!distDir) {
    return await serveSourceWebAsset(decodedPathname)
      ?? serveSourceWebBundle(req, decodedPathname);
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
    return new Response(assetFile, { headers: webDistFileHeaders(assetPath) });
  }

  if (!acceptsHtml(req) || looksLikeFileAsset(decodedPathname)) {
    return new Response("Not found", { status: 404 });
  }

  const spaIndex = Bun.file(`${distDir}/index.html`);
  if (await spaIndex.exists()) {
    return new Response(spaIndex, { headers: webDistFileHeaders("index.html") });
  }

  return new Response("Configured web dist is missing index.html.", { status: 500 });
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
      "/*": (req) => serveWebApp(req),
    },
    websocket: websocketHandlers,
    development: isServerDevelopmentMode(),
  });
}
