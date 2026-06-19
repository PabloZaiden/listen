import type { ZodError, ZodSchema } from "zod";
import { WEBHOOK_JSON_BODY_MAX_BYTES } from "@listen/shared";
import { createLogger, errorLogFields } from "../core/logger";
import { errorResponse } from "./helpers";

const log = createLogger("api:validation");

export class RequestValidationError extends Error {
  public constructor(
    message: string,
    public readonly response: Response,
  ) {
    super(message);
    this.name = "RequestValidationError";
  }
}

function requestBodyTooLargeError(): RequestValidationError {
  return new RequestValidationError("Request body too large", errorResponse(413, "request_body_too_large", "Request body is too large"));
}

async function cancelOversizedBodyReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel("Request body is too large");
  } catch (error) {
    log.warn("Failed to cancel oversized request body stream", errorLogFields(error));
  }
}

async function readJsonTextBody(req: Request, maxBytes: number): Promise<string> {
  if (!req.body) {
    return "";
  }

  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let body = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      await cancelOversizedBodyReader(reader);
      throw requestBodyTooLargeError();
    }
    body += decoder.decode(value, { stream: true });
  }

  return body + decoder.decode();
}

export async function parseJsonBody(req: Request, maxBytes = WEBHOOK_JSON_BODY_MAX_BYTES): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new RequestValidationError("Unsupported content type", errorResponse(415, "unsupported_content_type", "Content-Type must be application/json"));
  }
  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw requestBodyTooLargeError();
  }
  const body = await readJsonTextBody(req, maxBytes);
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
