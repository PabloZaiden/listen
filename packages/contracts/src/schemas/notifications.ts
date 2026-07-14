import { z } from "zod";
import {
  LIST_NOTIFICATIONS_DEFAULT_LIMIT,
  LIST_NOTIFICATIONS_MAX_LIMIT,
  NOTIFICATION_MARKDOWN_MAX_BYTES,
} from "@listen/shared";

export const notificationListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  shortDescription: z.string(),
  source: z.string(),
  sourceId: z.string().optional(),
  icon: z.string().optional(),
  createdAt: z.string(),
  openedAt: z.string().optional(),
});

export const notificationDetailSchema = notificationListItemSchema.extend({
  markdownContent: z.string(),
  openedAt: z.string(),
});

export const listNotificationsQuerySchema = z.object({
  sourceId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(LIST_NOTIFICATIONS_MAX_LIMIT).default(LIST_NOTIFICATIONS_DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
  opened: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});

export const markdownContentSchema = z.string().min(1).refine(
  (value) => new TextEncoder().encode(value).byteLength <= NOTIFICATION_MARKDOWN_MAX_BYTES,
  "Markdown content exceeds maximum byte length",
);

export type NotificationListItem = z.infer<typeof notificationListItemSchema>;
export type NotificationDetail = z.infer<typeof notificationDetailSchema>;
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
