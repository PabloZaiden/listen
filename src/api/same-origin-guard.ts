import { getRequestOrigin } from "../core/request-origin";
import type { ServerConfig } from "../core/server-config";
import { errorResponse } from "./helpers";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function checkSameOrigin(req: Request, config: Pick<ServerConfig, "sameOriginCheckDisabled">, force = false): Response | undefined {
  if (config.sameOriginCheckDisabled) {
    return undefined;
  }
  if (!force && !STATE_CHANGING_METHODS.has(req.method)) {
    return undefined;
  }
  const expectedOrigin = getRequestOrigin(req).origin;
  const origin = req.headers.get("origin");
  if (origin) {
    return origin === expectedOrigin ? undefined : errorResponse(403, "same_origin_required", "Request origin is not allowed");
  }
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin ? undefined : errorResponse(403, "same_origin_required", "Request origin is not allowed");
    } catch {
      return errorResponse(403, "same_origin_required", "Request origin is not allowed");
    }
  }
  return errorResponse(403, "same_origin_required", "Request origin is not allowed");
}
