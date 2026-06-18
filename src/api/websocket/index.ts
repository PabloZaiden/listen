import type { ServerWebSocket, WebSocketHandler } from "bun";
import { closeConnection, openConnection } from "./connection";
import { handleWebSocketMessage } from "./message-handler";
import type { WebSocketData } from "./types";

export const websocketHandlers = {
  open(ws: ServerWebSocket<WebSocketData>) {
    openConnection(ws);
  },
  message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
    handleWebSocketMessage(ws, message);
  },
  close(ws: ServerWebSocket<WebSocketData>) {
    closeConnection(ws);
  },
} satisfies WebSocketHandler<WebSocketData>;
