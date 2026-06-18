import { listNotificationsQuerySchema } from "@listen/contracts";
import { deleteNotification, deleteNotifications, listNotifications, openNotification } from "../core/notifications";
import { jsonResponse, methodNotAllowed, notFound, successResponse } from "./helpers";
import { parseWithSchema } from "./validation";

export function handleNotifications(req: Request): Response | undefined {
  const url = new URL(req.url);
  if (url.pathname === "/api/notifications") {
    if (req.method === "GET") {
      const query = parseWithSchema(listNotificationsQuerySchema, Object.fromEntries(url.searchParams));
      return jsonResponse(listNotifications({
        sourceId: query.sourceId,
        limit: query.limit,
        offset: query.offset,
        opened: query.opened === undefined ? undefined : query.opened === "true",
      }));
    }
    if (req.method === "DELETE") {
      const sourceId = url.searchParams.get("sourceId") ?? undefined;
      return successResponse({ success: true, deletedCount: deleteNotifications(sourceId) });
    }
    return methodNotAllowed();
  }

  const match = /^\/api\/notifications\/([^/]+)$/.exec(url.pathname);
  if (!match) {
    return undefined;
  }
  const id = decodeURIComponent(match[1] ?? "");
  if (req.method === "GET") {
    const notification = openNotification(id);
    return notification ? jsonResponse({ notification }) : notFound("Notification not found");
  }
  if (req.method === "DELETE") {
    return deleteNotification(id) ? successResponse() : notFound("Notification not found");
  }
  return methodNotAllowed();
}
