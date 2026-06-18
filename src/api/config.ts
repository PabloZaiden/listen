import type { ServerConfig } from "../core/server-config";
import { passkeyStatus } from "../core/passkey-auth";
import { jsonResponse } from "./helpers";

export async function configRoute(req: Request, config: ServerConfig): Promise<Response> {
  return jsonResponse({
    appName: "Listen",
    passkeyAuth: await passkeyStatus(req, config),
  });
}
