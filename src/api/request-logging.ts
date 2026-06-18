import { createLogger } from "../core/logger";

const log = createLogger("request");

export function redactPath(pathname: string): string {
  const match = /^\/api\/webhooks\/([^/]+)\/[^/]+/.exec(pathname);
  if (!match) {
    return pathname;
  }
  return `/api/webhooks/${match[1]}/[redacted]`;
}

export async function withRequestLogging(req: Request, handler: () => Promise<Response | undefined> | Response | undefined): Promise<Response | undefined> {
  const url = new URL(req.url);
  const start = performance.now();
  try {
    const response = await handler();
    log.info("request", {
      method: req.method,
      path: redactPath(url.pathname),
      status: response?.status ?? 101,
      durationMs: Math.round(performance.now() - start),
    });
    return response;
  } catch (error) {
    log.error("request failed", {
      method: req.method,
      path: redactPath(url.pathname),
      durationMs: Math.round(performance.now() - start),
      error,
    });
    throw error;
  }
}
