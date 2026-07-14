import type { WebAppRoute } from "@pablozaiden/webapp/web";

export function notificationRoute(id: string, sourceId?: string): WebAppRoute {
  return sourceId ? { view: "notification", id, sourceId } : { view: "notification", id };
}

export function sourceFilterRoute(sourceId?: string): WebAppRoute {
  return sourceId ? { view: "inbox", sourceId } : { view: "inbox" };
}

export function sourceIdFromRoute(route: WebAppRoute): string | undefined {
  return typeof route.sourceId === "string" ? route.sourceId : undefined;
}
