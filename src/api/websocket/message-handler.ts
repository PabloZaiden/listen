import type { ServerWebSocket } from "bun";
import type { WebSocketData } from "./types";

export function handleWebSocketMessage(ws: ServerWebSocket<WebSocketData>, message: string | Buffer): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof message === "string" ? message : message.toString("utf8"));
  } catch {
    return;
  }
  if (typeof parsed === "object" && parsed !== null && "type" in parsed && parsed.type === "ping") {
    ws.send(JSON.stringify({ type: "pong" }));
  }
}
