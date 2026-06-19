import type { ServerWebSocket } from "bun";
import { MAX_CONNECTIONS } from "@listen/shared";
import { subscribe, type ListenRealtimeEvent } from "../../core/event-emitter";
import { createLogger, errorLogFields } from "../../core/logger";
import type { WebSocketData } from "./types";

const log = createLogger("websocket");
const connections: Array<ServerWebSocket<WebSocketData>> = [];

function eventSourceId(event: ListenRealtimeEvent): string | undefined {
  if ("notification" in event) {
    return event.notification.sourceId;
  }
  if ("source" in event) {
    return event.source.id;
  }
  if ("sourceId" in event) {
    return event.sourceId;
  }
  return undefined;
}

function shouldSend(ws: ServerWebSocket<WebSocketData>, event: ListenRealtimeEvent): boolean {
  if (!ws.data.sourceId) {
    return true;
  }
  const sourceId = eventSourceId(event);
  return sourceId === undefined || sourceId === ws.data.sourceId;
}

export function openConnection(ws: ServerWebSocket<WebSocketData>): void {
  connections.push(ws);
  log.trace("WebSocket connection opened", { sourceId: ws.data.sourceId, connectionCount: connections.length });
  if (connections.length > MAX_CONNECTIONS) {
    const oldest = connections.shift();
    oldest?.close(1008, "Connection limit exceeded");
    log.warn("WebSocket connection limit exceeded", { maxConnections: MAX_CONNECTIONS, connectionCount: connections.length });
  }
  const unsubscribe = subscribe((event) => {
    if (shouldSend(ws, event)) {
      try {
        ws.send(JSON.stringify(event));
      } catch (error) {
        log.warn("WebSocket realtime send failed", { type: event.type, sourceId: ws.data.sourceId, ...errorLogFields(error) });
      }
    }
  });
  ws.data.unsubscribers = [unsubscribe];
  ws.send(JSON.stringify({ type: "connected", sourceId: ws.data.sourceId ?? null }));
}

export function closeConnection(ws: ServerWebSocket<WebSocketData>): void {
  const index = connections.indexOf(ws);
  if (index >= 0) {
    connections.splice(index, 1);
  }
  for (const unsubscribe of ws.data.unsubscribers ?? []) {
    unsubscribe();
  }
  ws.data.unsubscribers = [];
  log.trace("WebSocket connection closed", { sourceId: ws.data.sourceId, connectionCount: connections.length });
}

export function resetConnectionsForTests(): void {
  for (const connection of [...connections]) {
    connection.close();
  }
  connections.length = 0;
}
