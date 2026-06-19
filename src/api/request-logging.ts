import { createLogger, errorLogFields } from "../core/logger";

const log = createLogger("request");

export function redactPath(pathname: string): string {
  const match = /^\/api\/webhooks\/([^/]+)\/[^/]+/.exec(pathname);
  if (!match) {
    return pathname;
  }
  return `/api/webhooks/${match[1]}/[redacted]`;
}

async function responseLogFields(response: Response | undefined): Promise<Record<string, unknown>> {
  if (!response || response.status < 400) {
    return {};
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return {};
  }
  try {
    const body = await response.clone().json() as { error?: unknown; message?: unknown; details?: unknown };
    return {
      errorCode: typeof body.error === "string" ? body.error : undefined,
      errorMessage: typeof body.message === "string" ? body.message : undefined,
      errorDetails: body.details,
    };
  } catch {
    return {};
  }
}

export async function withRequestLogging(req: Request, handler: () => Promise<Response | undefined> | Response | undefined): Promise<Response | undefined> {
  const url = new URL(req.url);
  const start = performance.now();
  try {
    const response = await handler();
    const fields = {
      method: req.method,
      path: redactPath(url.pathname),
      status: response?.status ?? 101,
      durationMs: Math.round(performance.now() - start),
      ...await responseLogFields(response),
    };
    if ((response?.status ?? 101) >= 500) {
      log.error("request", fields);
    } else if ((response?.status ?? 101) >= 400) {
      log.warn("request", fields);
    } else {
      log.trace("request", fields);
    }
    return response;
  } catch (error) {
    log.error("request failed", {
      method: req.method,
      path: redactPath(url.pathname),
      durationMs: Math.round(performance.now() - start),
      ...errorLogFields(error),
    });
    throw error;
  }
}
