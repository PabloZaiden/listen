import { setLogLevelRequestSchema } from "@listen/contracts";
import { DEFAULT_LOG_LEVEL, VALID_LOG_LEVELS, type LogLevelName } from "@listen/shared";
import { getLogLevel, isLogLevelFromEnv, setLogLevel, createLogger, errorLogFields } from "../core/logger";
import { getLogLevelPreference, setLogLevelPreference } from "../persistence/preferences";
import { errorResponse, jsonResponse, methodNotAllowed, successResponse } from "./helpers";
import { parseJsonBody, parseWithSchema, RequestValidationError } from "./validation";

const log = createLogger("api:preferences");

export async function handlePreferences(req: Request): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (url.pathname !== "/api/preferences/log-level") {
    return undefined;
  }

  try {
    if (req.method === "GET") {
      return jsonResponse({
        level: isLogLevelFromEnv() ? getLogLevel() : getLogLevelPreference(),
        defaultLevel: DEFAULT_LOG_LEVEL,
        availableLevels: VALID_LOG_LEVELS,
        isFromEnv: isLogLevelFromEnv(),
      });
    }

    if (req.method === "PUT") {
      const body = parseWithSchema(setLogLevelRequestSchema, await parseJsonBody(req));
      const level = body.level as LogLevelName;
      if (isLogLevelFromEnv()) {
        log.warn("Log level preference update ignored because LISTEN_LOG_LEVEL is set", { requestedLevel: level, currentLevel: getLogLevel() });
        return errorResponse(409, "log_level_controlled_by_env", "Log level is controlled by LISTEN_LOG_LEVEL");
      }
      setLogLevelPreference(level);
      setLogLevel(level);
      log.info("Log level updated", { level });
      return successResponse({ success: true, level });
    }

    return methodNotAllowed();
  } catch (error) {
    if (error instanceof RequestValidationError) {
      log.warn("Log level preference request validation failed", { method: req.method, message: error.message });
      return error.response;
    }
    log.error("Log level preference operation failed", { method: req.method, ...errorLogFields(error) });
    return errorResponse(500, "preference_operation_failed", "Preference operation failed");
  }
}