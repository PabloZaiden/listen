import { z } from "zod";
import { NOTIFICATION_SOURCE_NAME_MAX_CHARS } from "@listen/shared";

export const createSourceRequestSchema = z.object({
  name: z.string().trim().min(1).max(NOTIFICATION_SOURCE_NAME_MAX_CHARS),
}).strict();

export const sourceResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastUsedAt: z.string().optional(),
}).strict();

export const sourceMutationResponseSchema = z.object({
  source: sourceResponseSchema,
  webhookUrl: z.string().url(),
}).strict();

export type CreateSourceRequest = z.infer<typeof createSourceRequestSchema>;
export type SourceResponse = z.infer<typeof sourceResponseSchema>;
export type SourceMutationResponse = z.infer<typeof sourceMutationResponseSchema>;
