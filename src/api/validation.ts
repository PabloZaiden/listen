import type { ZodError, ZodSchema } from "zod";
import { WEBHOOK_JSON_BODY_MAX_BYTES } from "@listen/shared";
import { errorResponse } from "./helpers";

export class RequestValidationError extends Error {
  public constructor(
    message: string,
    public readonly response: Response,
  ) {
    super(message);
    this.name = "RequestValidationError";
  }
}

export async function parseJsonBody(req: Request, maxBytes = WEBHOOK_JSON_BODY_MAX_BYTES): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new RequestValidationError("Unsupported content type", errorResponse(415, "unsupported_content_type", "Content-Type must be application/json"));
  }
  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new RequestValidationError("Request body too large", errorResponse(413, "request_body_too_large", "Request body is too large"));
  }
  const body = await req.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    throw new RequestValidationError("Request body too large", errorResponse(413, "request_body_too_large", "Request body is too large"));
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new RequestValidationError("Malformed JSON", errorResponse(400, "malformed_json", "Request body must be valid JSON"));
  }
}

export function parseWithSchema<T>(schema: ZodSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new RequestValidationError("Validation failed", errorResponse(400, "validation_failed", "Request validation failed", formatZodError(parsed.error)));
  }
  return parsed.data;
}

function formatZodError(error: ZodError): unknown {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
