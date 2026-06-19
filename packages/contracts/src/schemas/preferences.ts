import { z } from "zod";
import { DEFAULT_LOG_LEVEL, VALID_LOG_LEVELS } from "@listen/shared";

export const setLogLevelRequestSchema = z.object({
  level: z.enum(VALID_LOG_LEVELS),
}).strict();

export const logLevelPreferenceResponseSchema = z.object({
  level: z.enum(VALID_LOG_LEVELS),
  defaultLevel: z.literal(DEFAULT_LOG_LEVEL),
  availableLevels: z.array(z.enum(VALID_LOG_LEVELS)),
  isFromEnv: z.boolean(),
});

export type SetLogLevelRequest = z.infer<typeof setLogLevelRequestSchema>;
export type LogLevelPreferenceResponse = z.infer<typeof logLevelPreferenceResponseSchema>;