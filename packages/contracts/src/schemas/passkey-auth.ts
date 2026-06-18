import { z } from "zod";

export const passkeyAuthStatusResponseSchema = z.object({
  passkeyConfigured: z.boolean(),
  passkeyDisabled: z.boolean(),
  passkeyRequired: z.boolean(),
  authenticated: z.boolean(),
});

export type PasskeyAuthStatusResponse = z.infer<typeof passkeyAuthStatusResponseSchema>;
