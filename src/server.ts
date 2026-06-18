import type { Server } from "bun";
import { initializeDatabase } from "./persistence/database";
import { handleApiRequest } from "./api";
import { websocketHandlers } from "./api/websocket";
import type { WebSocketData } from "./api/websocket/types";
import { readServerConfig, type ServerConfig } from "./core/server-config";
import { createLogger } from "./core/logger";
import mainJs from "./public/assets/main.js" with { type: "text" };
import stylesCss from "./web/styles.css" with { type: "text" };

const log = createLogger("server");
const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Listen</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/main.js"></script>
  </body>
</html>`;

async function serveStatic(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/styles.css") {
    return new Response(stylesCss, { headers: { "content-type": "text/css; charset=utf-8" } });
  }
  if (url.pathname === "/assets/main.js") {
    return new Response(mainJs, { headers: { "content-type": "application/javascript; charset=utf-8" } });
  }
  return new Response(indexHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export function createFetchHandler(config: ServerConfig): (req: Request, server?: Server<WebSocketData>) => Promise<Response | undefined> {
  return async (req, server) => {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest(req, config, server);
    }
    return serveStatic(req);
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
    fetch: createFetchHandler(config),
    websocket: websocketHandlers,
  });
}
