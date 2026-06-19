import { hasValidPasskeySession, isPasskeyConfigured } from "../core/passkey-auth";
import { createLogger } from "../core/logger";
import type { ServerConfig } from "../core/server-config";
import { errorResponse } from "./helpers";

const log = createLogger("api:passkey-guard");

export async function requirePasskeyAuth(req: Request, config: Pick<ServerConfig, "passkeyDisabled">): Promise<Response | undefined> {
  if (config.passkeyDisabled) {
    return undefined;
  }
  const headers = { "x-passkey-auth-required": "true" };
  if (!isPasskeyConfigured()) {
    log.warn("Passkey setup required", { method: req.method, path: new URL(req.url).pathname });
    return errorResponse(401, "passkey_setup_required", "Set up a passkey before using Listen", undefined, headers);
  }
  if (!await hasValidPasskeySession(req)) {
    log.warn("Passkey authentication required", { method: req.method, path: new URL(req.url).pathname });
    return errorResponse(401, "authentication_required", "Passkey authentication is required", undefined, headers);
  }
  return undefined;
}
