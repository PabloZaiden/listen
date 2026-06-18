import type { NotificationListItem, SourceResponse } from "@listen/contracts";
import { createLogger } from "./logger";

export type ListenRealtimeEvent =
  | { type: "notification.created"; notification: NotificationListItem }
  | { type: "notification.opened"; notification: NotificationListItem }
  | { type: "notification.deleted"; notificationId: string; sourceId?: string }
  | { type: "notifications.deleted"; sourceId?: string; deletedCount: number }
  | { type: "source.created"; source: SourceResponse }
  | { type: "source.updated"; source: SourceResponse }
  | { type: "source.deleted"; sourceId: string };

export type ListenRealtimeListener = (event: ListenRealtimeEvent) => void;

const log = createLogger("event-emitter");
const listeners = new Set<ListenRealtimeListener>();

export function subscribe(listener: ListenRealtimeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit(event: ListenRealtimeEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      log.warn("Realtime listener failed", { error });
    }
  }
}

export function resetEventEmitterForTests(): void {
  listeners.clear();
}
