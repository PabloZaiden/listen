import { createLogger } from "../core/logger";
import { methodNotAllowed, successResponse } from "./helpers";

const log = createLogger("api:server-control");
const SERVER_KILL_PATH = "/api/server/kill";
const SHUTDOWN_DELAY_MS = 100;

export type ServerShutdown = () => void;
export type ShutdownScheduler = (callback: () => void, delayMs: number) => unknown;

export function scheduleServerShutdown(scheduler: ShutdownScheduler = setTimeout): void {
  scheduler(() => {
    log.info("Server is shutting down...");
    process.exit(0);
  }, SHUTDOWN_DELAY_MS);
}

export function handleServerControl(req: Request, shutdown: ServerShutdown = scheduleServerShutdown): Response | undefined {
  const pathname = new URL(req.url).pathname;
  if (pathname !== SERVER_KILL_PATH) {
    return undefined;
  }

  if (req.method !== "POST") {
    return methodNotAllowed();
  }

  log.warn("POST /api/server/kill - Server kill requested");
  shutdown();
  return successResponse({
    success: true,
    message: "Server is shutting down. The connection will be lost.",
  });
}
