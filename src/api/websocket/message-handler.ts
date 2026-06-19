import type { ServerWebSocket } from "bun";
import { createLogger } from "../../core/logger";
import type { WebSocketData } from "./types";

const log = createLogger("websocket:messages");

export function handleWebSocketMessage(ws: ServerWebSocket<WebSocketData>, message: string | Buffer): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof message === "string" ? message : message.toString("utf8"));
  } catch {
    log.warn("WebSocket message ignored because JSON parsing failed", { sourceId: ws.data.sourceId });
    return;
  }
  if (typeof parsed === "object" && parsed !== null && "type" in parsed && parsed.type === "ping") {
    ws.send(JSON.stringify({ type: "pong" }));
    log.trace("WebSocket ping handled", { sourceId: ws.data.sourceId });
    return;
  }
  log.warn("WebSocket message ignored because type is unsupported", { sourceId: ws.data.sourceId });
}
