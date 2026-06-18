export interface WebSocketData {
  sourceId?: string;
  unsubscribers?: Array<() => void>;
}
