import type { NotificationListItem, SourceResponse } from "@listen/contracts";
import { createLogger, errorLogFields } from "./logger";

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
  log.trace("Realtime listener subscribed", { listenerCount: listeners.size });
  return () => {
    listeners.delete(listener);
    log.trace("Realtime listener unsubscribed", { listenerCount: listeners.size });
  };
}

export function emit(event: ListenRealtimeEvent): void {
  log.trace("Realtime event emitted", { type: event.type, listenerCount: listeners.size });
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      log.warn("Realtime listener failed", { type: event.type, ...errorLogFields(error) });
    }
  }
}

export function resetEventEmitterForTests(): void {
  listeners.clear();
}
