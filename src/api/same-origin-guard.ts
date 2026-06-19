import { getRequestOrigin } from "../core/request-origin";
import { createLogger } from "../core/logger";
import type { ServerConfig } from "../core/server-config";
import { errorResponse } from "./helpers";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const log = createLogger("api:same-origin");

function originFailure(req: Request, reason: string, expectedOrigin: string, receivedOrigin?: string): Response {
  log.warn("Same-origin check failed", {
    method: req.method,
    path: new URL(req.url).pathname,
    reason,
    expectedOrigin,
    receivedOrigin,
  });
  return errorResponse(403, "same_origin_required", "Request origin is not allowed");
}

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
    return origin === expectedOrigin ? undefined : originFailure(req, "origin_mismatch", expectedOrigin, origin);
  }
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      return refererOrigin === expectedOrigin ? undefined : originFailure(req, "referer_mismatch", expectedOrigin, refererOrigin);
    } catch {
      return originFailure(req, "malformed_referer", expectedOrigin);
    }
  }
  return originFailure(req, "missing_origin", expectedOrigin);
}
