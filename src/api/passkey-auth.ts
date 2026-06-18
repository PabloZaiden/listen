import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { ServerConfig } from "../core/server-config";
import {
  authenticationOptions,
  deleteConfiguredPasskey,
  logoutHeaders,
  passkeyStatus,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "../core/passkey-auth";
import { errorResponse, jsonResponse, successResponse } from "./helpers";
import { parseJsonBody, RequestValidationError } from "./validation";

export async function handlePasskeyAuth(req: Request, config: ServerConfig): Promise<Response | undefined> {
  const url = new URL(req.url);
  try {
    if (req.method === "GET" && url.pathname === "/api/passkey-auth/status") {
      return jsonResponse(await passkeyStatus(req, config));
    }
    if (req.method === "GET" && url.pathname === "/api/passkey-auth/registration/options") {
      const result = await registrationOptions(req);
      return jsonResponse(result.options, { headers: result.headers });
    }
    if (req.method === "POST" && url.pathname === "/api/passkey-auth/registration/verify") {
      const body = await parseJsonBody(req);
      const headers = await verifyRegistration(req, body as RegistrationResponseJSON);
      return successResponse({ verified: true, success: true }, { headers });
    }
    if (req.method === "GET" && url.pathname === "/api/passkey-auth/authentication/options") {
      const result = await authenticationOptions(req);
      return jsonResponse(result.options, { headers: result.headers });
    }
    if (req.method === "POST" && url.pathname === "/api/passkey-auth/authentication/verify") {
      const body = await parseJsonBody(req);
      const headers = await verifyAuthentication(req, body as AuthenticationResponseJSON);
      return successResponse({ verified: true, success: true }, { headers });
    }
    if (req.method === "POST" && url.pathname === "/api/passkey-auth/logout") {
      return successResponse({ success: true }, { headers: logoutHeaders() });
    }
    if (req.method === "DELETE" && url.pathname === "/api/passkey-auth/passkey") {
      return successResponse({ success: true }, { headers: deleteConfiguredPasskey() });
    }
    return undefined;
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return error.response;
    }
    return errorResponse(400, "passkey_auth_failed", error instanceof Error ? error.message : "Passkey authentication failed");
  }
}
