import { createSourceRequestSchema } from "@listen/contracts";
import { createSource, listSources, rotateSourceToken, softDisableSource } from "../core/sources";
import { createLogger, errorLogFields } from "../core/logger";
import { errorResponse, jsonResponse, methodNotAllowed, notFound, successResponse } from "./helpers";
import { parseJsonBody, parseWithSchema, RequestValidationError } from "./validation";

const log = createLogger("api:sources");

export async function handleSources(req: Request): Promise<Response | undefined> {
  const url = new URL(req.url);
  try {
    if (url.pathname === "/api/sources") {
      if (req.method === "GET") {
        return jsonResponse({ sources: listSources(url.searchParams.get("includeDisabled") === "true") });
      }
      if (req.method === "POST") {
        const body = parseWithSchema(createSourceRequestSchema, await parseJsonBody(req));
        return jsonResponse(await createSource(body.name, req), { status: 201 });
      }
      return methodNotAllowed();
    }

    const rotateMatch = /^\/api\/sources\/([^/]+)\/token\/rotate$/.exec(url.pathname);
    if (rotateMatch) {
      if (req.method !== "POST") {
        return methodNotAllowed();
      }
      const source = await rotateSourceToken(decodeURIComponent(rotateMatch[1] ?? ""), req);
      return source ? jsonResponse(source) : notFound("Source not found");
    }

    const sourceMatch = /^\/api\/sources\/([^/]+)$/.exec(url.pathname);
    if (sourceMatch) {
      if (req.method !== "DELETE") {
        return methodNotAllowed();
      }
      return softDisableSource(decodeURIComponent(sourceMatch[1] ?? ""))
        ? successResponse()
        : notFound("Source not found");
    }
    return undefined;
  } catch (error) {
    if (error instanceof RequestValidationError) {
      log.warn("Source request validation failed", { path: url.pathname, method: req.method, message: error.message });
      return error.response;
    }
    log.error("Source operation failed", { path: url.pathname, method: req.method, ...errorLogFields(error) });
    return errorResponse(500, "source_operation_failed", "Source operation failed");
  }
}
