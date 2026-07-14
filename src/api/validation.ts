import { parseJson, errorResponse } from "@pablozaiden/webapp/server";
import { webhookNotificationRequestSchema, type WebhookNotificationRequest } from "@listen/contracts";
import { WEBHOOK_JSON_BODY_MAX_BYTES } from "@listen/shared";
import { z } from "zod";
import { createLogger, errorLogFields } from "../core/logger";

const log = createLogger("api:validation");

export class RequestBodyLimitError extends Error {
  public constructor(
    message: string,
    public readonly response: Response,
  ) {
    super(message);
    this.name = "RequestBodyLimitError";
  }
}

export function parseQuery<TSchema extends z.ZodTypeAny>(req: Request, schema: TSchema): z.infer<TSchema> | Response {
  const result = schema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  if (result.success) {
    return result.data;
  }
  return errorResponse(
    400,
    "invalid_request_query",
    "Query parameters failed validation",
    result.error.issues.map((issue) => ({
      path: issue.path.map((segment) => typeof segment === "symbol" ? String(segment) : segment),
      code: issue.code,
      message: issue.message,
    })),
  );
}

function requestBodyTooLargeError(): RequestBodyLimitError {
  return new RequestBodyLimitError("Request body too large", errorResponse(413, "request_body_too_large", "Request body is too large"));
}

async function cancelOversizedBodyReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel("Request body is too large");
  } catch (error) {
    log.warn("Failed to cancel oversized request body stream", errorLogFields(error));
  }
}

async function readLimitedBody(req: Request, maxBytes: number): Promise<string> {
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

export async function parseWebhookNotification(req: Request, maxBytes = WEBHOOK_JSON_BODY_MAX_BYTES): Promise<WebhookNotificationRequest> {
  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw requestBodyTooLargeError();
  }
  const body = await readLimitedBody(req, maxBytes);
  const limitedRequest = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body,
  });
  return parseJson(limitedRequest, webhookNotificationRequestSchema);
}
