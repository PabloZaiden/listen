import type { ErrorResponse } from "@listen/contracts";

export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function errorResponse(status: number, error: string, message: string, details?: unknown, headers?: HeadersInit): Response {
  const body: ErrorResponse = details === undefined ? { error, message } : { error, message, details };
  return jsonResponse(body, { status, headers });
}

export function successResponse(body: unknown = { success: true }, init?: ResponseInit): Response {
  return jsonResponse(body, init);
}

export function notFound(message = "Not found"): Response {
  return errorResponse(404, "not_found", message);
}

export function methodNotAllowed(): Response {
  return errorResponse(405, "method_not_allowed", "Method not allowed");
}
