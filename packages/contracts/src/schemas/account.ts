import { z } from "zod";

export const bootstrapAccountRequestSchema = z.object({
  username: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
}).strict();

export const passkeyVerificationRequestSchema = z.object({
  challengeId: z.string().uuid(),
  response: z.record(z.string(), z.unknown()),
}).strict();

export const themePreferenceRequestSchema = z.object({
  theme: z.enum(["dark", "light", "system"]),
}).strict();

export const accountStatusResponseSchema = z.object({
  authenticated: z.boolean(),
  bootstrapRequired: z.boolean(),
  owner: z.object({ username: z.string() }).optional(),
  theme: z.enum(["dark", "light", "system"]).optional(),
});

export type AccountStatus = z.infer<typeof accountStatusResponseSchema>;
