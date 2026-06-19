import { z } from "zod";
import {
  BROWSER_PUSH_ENDPOINT_MAX_CHARS,
  BROWSER_PUSH_KEY_MAX_CHARS,
} from "@listen/shared";

export const browserPushKeysSchema = z.object({
  p256dh: z.string().min(1).max(BROWSER_PUSH_KEY_MAX_CHARS),
  auth: z.string().min(1).max(BROWSER_PUSH_KEY_MAX_CHARS),
}).strict();

export const browserPushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(BROWSER_PUSH_ENDPOINT_MAX_CHARS),
  expirationTime: z.number().int().nonnegative().nullable().optional(),
  keys: browserPushKeysSchema,
}).strict();

export const browserPushSubscribeRequestSchema = z.object({
  subscription: browserPushSubscriptionSchema,
}).strict();

export const browserPushEndpointRequestSchema = z.object({
  endpoint: z.string().url().max(BROWSER_PUSH_ENDPOINT_MAX_CHARS),
}).strict();

export const browserPushConfigResponseSchema = z.object({
  publicKey: z.string().min(1),
});

export const browserPushStatusResponseSchema = z.object({
  subscribed: z.boolean(),
});

export const browserPushSubscriptionResponseSchema = z.object({
  subscribed: z.literal(true),
});

export type BrowserPushKeys = z.infer<typeof browserPushKeysSchema>;
export type BrowserPushSubscription = z.infer<typeof browserPushSubscriptionSchema>;
export type BrowserPushSubscribeRequest = z.infer<typeof browserPushSubscribeRequestSchema>;
export type BrowserPushEndpointRequest = z.infer<typeof browserPushEndpointRequestSchema>;
export type BrowserPushConfigResponse = z.infer<typeof browserPushConfigResponseSchema>;
export type BrowserPushStatusResponse = z.infer<typeof browserPushStatusResponseSchema>;
export type BrowserPushSubscriptionResponse = z.infer<typeof browserPushSubscriptionResponseSchema>;
