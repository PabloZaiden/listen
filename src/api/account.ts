import { AuthBonusError, type AuthenticationResponseJSON, type RegistrationResponseJSON } from "@pablozaiden/webapp/auth";
import { defineRoutes, errorResponse, jsonResponse, parseJson, type ResourceRealtimeEvent, type RuntimeConfig } from "@pablozaiden/webapp/server";
import { accountStatusResponseSchema, bootstrapAccountRequestSchema, passkeyVerificationRequestSchema, themePreferenceRequestSchema } from "@listen/contracts";
import { accountPasskeys, accountSessions, accountStatus, bootstrapOwner, currentOwner, pendingBootstrapOwner, saveOwnerTheme, type OwnerAccount } from "../core/account";

function authFailure(error: unknown): Response {
  if (error instanceof AuthBonusError) return errorResponse(error.status, error.code, error.message);
  throw error;
}

export function createAccountRoutes(config: RuntimeConfig, allowAttempt: (request: Request) => boolean) {
  async function completeRegistration(req: Request, owner: OwnerAccount, bootstrap: boolean, challengeId: string, response: Record<string, unknown>): Promise<Response> {
    try {
      const result = await accountPasskeys(req, config, allowAttempt, { bootstrap, pendingOwner: bootstrap ? owner : undefined })
        .finishRegistration(req, owner.id, challengeId, response as unknown as RegistrationResponseJSON);
      const session = await accountSessions(req, config).create(owner.id, { expectedVersion: result.identity.version });
      return jsonResponse(accountStatusResponseSchema.parse(accountStatus(currentOwner())), { headers: { "set-cookie": session.cookie, "cache-control": "no-store" } });
    } catch (error) {
      return authFailure(error);
    }
  }
  return defineRoutes<ResourceRealtimeEvent, OwnerAccount>({
    "/api/account": {
      auth: "optional",
      responseSchema: accountStatusResponseSchema,
      GET: (_req, ctx) => jsonResponse(accountStatusResponseSchema.parse(accountStatus(ctx.identity)), { headers: { "cache-control": "no-store" } }),
    },
    "/api/account/bootstrap/options": {
      auth: "public",
      sameOrigin: "always",
      requestSchema: bootstrapAccountRequestSchema,
      async POST(req) {
        const body = await parseJson(req, bootstrapAccountRequestSchema);
        const owner = bootstrapOwner(body.username);
        if (!owner) return errorResponse(409, "already_configured", "Listen already has an owner passkey");
        try {
          return jsonResponse(await accountPasskeys(req, config, allowAttempt, { bootstrap: true, pendingOwner: owner }).beginRegistration(req, owner.id));
        } catch (error) {
          return authFailure(error);
        }
      },
    },
    "/api/account/bootstrap/verify": {
      auth: "public",
      sameOrigin: "always",
      requestSchema: passkeyVerificationRequestSchema,
      async POST(req) {
        const body = await parseJson(req, passkeyVerificationRequestSchema);
        const owner = pendingBootstrapOwner(body.challengeId);
        if (!owner) return errorResponse(409, "bootstrap_unavailable", "Owner enrollment is unavailable");
        return completeRegistration(req, owner, true, body.challengeId, body.response);
      },
    },
    "/api/account/login/options": {
      auth: "public",
      sameOrigin: "always",
      async POST(req) {
        const owner = currentOwner();
        if (!owner || accountStatus().bootstrapRequired) return errorResponse(409, "bootstrap_required", "Set up the owner passkey first");
        try {
          return jsonResponse(await accountPasskeys(req, config, allowAttempt).beginAuthentication(req, owner.id));
        } catch (error) {
          return authFailure(error);
        }
      },
    },
    "/api/account/login/verify": {
      auth: "public",
      sameOrigin: "always",
      requestSchema: passkeyVerificationRequestSchema,
      async POST(req) {
        const body = await parseJson(req, passkeyVerificationRequestSchema);
        try {
          const result = await accountPasskeys(req, config, allowAttempt).finishAuthentication(req, body.challengeId, body.response as unknown as AuthenticationResponseJSON);
          const session = await accountSessions(req, config).create(result.identity.id, { expectedVersion: result.identity.version });
          return jsonResponse(accountStatusResponseSchema.parse(accountStatus(currentOwner())), { headers: { "set-cookie": session.cookie, "cache-control": "no-store" } });
        } catch (error) {
          return authFailure(error);
        }
      },
    },
    "/api/account/passkey/options": {
      auth: "required",
      async POST(req, ctx) {
        try {
          return jsonResponse(await accountPasskeys(req, config, allowAttempt).beginRegistration(req, ctx.requireIdentity().id));
        } catch (error) {
          return authFailure(error);
        }
      },
    },
    "/api/account/passkey/verify": {
      auth: "required",
      requestSchema: passkeyVerificationRequestSchema,
      async POST(req, ctx) {
        const owner = ctx.requireIdentity();
        const body = await parseJson(req, passkeyVerificationRequestSchema);
        return completeRegistration(req, owner, false, body.challengeId, body.response);
      },
    },
    "/api/account/logout": {
      auth: "required",
      async POST(req) {
        try {
          const cookie = await accountSessions(req, config).logout(req);
          return jsonResponse({ success: true }, { headers: { "set-cookie": cookie, "cache-control": "no-store" } });
        } catch (error) {
          return authFailure(error);
        }
      },
    },
    "/api/account/theme": {
      auth: "required",
      requestSchema: themePreferenceRequestSchema,
      async PUT(req, ctx) {
        const owner = ctx.requireIdentity();
        const body = await parseJson(req, themePreferenceRequestSchema);
        saveOwnerTheme(owner, body.theme);
        return jsonResponse(body);
      },
    },
  });
}
