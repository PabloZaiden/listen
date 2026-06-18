import type { ServerWebSocket } from "bun";
import { MAX_CONNECTIONS } from "@listen/shared";
import { subscribe, type ListenRealtimeEvent } from "../../core/event-emitter";
import type { WebSocketData } from "./types";

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
  if (connections.length > MAX_CONNECTIONS) {
    const oldest = connections.shift();
    oldest?.close(1008, "Connection limit exceeded");
  }
  const unsubscribe = subscribe((event) => {
    if (shouldSend(ws, event)) {
      ws.send(JSON.stringify(event));
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
}

export function resetConnectionsForTests(): void {
  for (const connection of [...connections]) {
    connection.close();
  }
  connections.length = 0;
}
