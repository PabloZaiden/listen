import { browserPushEndpointRequestSchema, browserPushSubscribeRequestSchema } from "@listen/contracts";
import {
  getBrowserPushConfig,
  getBrowserPushSubscriptionStatus,
  subscribeBrowserPush,
  unsubscribeBrowserPush,
} from "../core/browser-push";
import { errorResponse, jsonResponse, methodNotAllowed } from "./helpers";
import { parseJsonBody, parseWithSchema, RequestValidationError } from "./validation";

export async function handleBrowserPush(req: Request): Promise<Response | undefined> {
  const url = new URL(req.url);
  try {
    if (url.pathname === "/api/browser-push/config") {
      if (req.method !== "GET") {
        return methodNotAllowed();
      }
      return jsonResponse(getBrowserPushConfig(req));
    }

    if (url.pathname === "/api/browser-push/subscriptions") {
      if (req.method === "POST") {
        const body = parseWithSchema(browserPushSubscribeRequestSchema, await parseJsonBody(req));
        return jsonResponse(subscribeBrowserPush(body.subscription, req), { status: 201 });
      }
      if (req.method === "DELETE") {
        const body = parseWithSchema(browserPushEndpointRequestSchema, await parseJsonBody(req));
        return jsonResponse(unsubscribeBrowserPush(body.endpoint));
      }
      return methodNotAllowed();
    }

    if (url.pathname === "/api/browser-push/subscriptions/lookup") {
      if (req.method !== "POST") {
        return methodNotAllowed();
      }
      const body = parseWithSchema(browserPushEndpointRequestSchema, await parseJsonBody(req));
      return jsonResponse(getBrowserPushSubscriptionStatus(body.endpoint));
    }

    return undefined;
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return error.response;
    }
    return errorResponse(500, "browser_push_operation_failed", "Browser push operation failed");
  }
}
