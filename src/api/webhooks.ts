import { webhookNotificationRequestSchema } from "@listen/contracts";
import { createNotificationFromWebhook } from "../core/notifications";
import { getSourceForWebhook, markSourceUsed } from "../core/sources";
import { verifyWebhookToken } from "../core/webhook-tokens";
import { getRequestOrigin } from "../core/request-origin";
import { createLogger } from "../core/logger";
import { errorResponse, jsonResponse, methodNotAllowed } from "./helpers";
import { parseJsonBody, parseWithSchema, RequestValidationError } from "./validation";

const log = createLogger("api:webhooks");

export async function handleWebhook(req: Request): Promise<Response | undefined> {
  const url = new URL(req.url);
  const match = /^\/api\/webhooks\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (!match) {
    return undefined;
  }
  if (req.method !== "POST") {
    return methodNotAllowed();
  }

  const sourceId = decodeURIComponent(match[1] ?? "");
  const token = decodeURIComponent(match[2] ?? "");
  const source = getSourceForWebhook(sourceId);
  if (!source) {
    log.warn("Webhook source not found", { sourceId });
    return errorResponse(404, "source_not_found", "Webhook source was not found");
  }
  if (source.disabledAt) {
    log.warn("Webhook source disabled", { sourceId });
    return errorResponse(410, "source_disabled", "Webhook source is disabled");
  }
  if (!await verifyWebhookToken(token, source.tokenHash)) {
    log.warn("Webhook token invalid", { sourceId });
    return errorResponse(401, "invalid_webhook_token", "Webhook token is invalid");
  }

  try {
    const payload = parseWithSchema(webhookNotificationRequestSchema, await parseJsonBody(req));
    const notification = createNotificationFromWebhook(payload, { id: source.id, name: source.name }, { publicOrigin: getRequestOrigin(req).origin });
    markSourceUsed(source.id);
    log.info("Webhook notification accepted", { sourceId: source.id, notificationId: notification.id });
    return jsonResponse({ id: notification.id }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      log.warn("Webhook request validation failed", { sourceId, message: error.message });
      return error.response;
    }
    throw error;
  }
}
