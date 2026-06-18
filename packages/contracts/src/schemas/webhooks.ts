import { z } from "zod";
import {
  NOTIFICATION_ICON_MAX_BYTES,
  NOTIFICATION_SHORT_DESCRIPTION_MAX_CHARS,
  NOTIFICATION_TITLE_MAX_CHARS,
} from "@listen/shared";
import { markdownContentSchema } from "./notifications";

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

export function decodePngDataUrl(value: string): Uint8Array | null {
  if (!value.startsWith(PNG_DATA_URL_PREFIX)) {
    return null;
  }

  const encoded = value.slice(PNG_DATA_URL_PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) && !/^[A-Za-z0-9_-]+={0,2}$/.test(encoded)) {
    return null;
  }

  try {
    const bytes = Uint8Array.from(atob(encoded.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
    if (bytes.length > NOTIFICATION_ICON_MAX_BYTES) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  }
}

export function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
}

export const webhookNotificationRequestSchema = z.object({
  title: z.string().trim().min(1).max(NOTIFICATION_TITLE_MAX_CHARS),
  shortDescription: z.string().trim().min(1).max(NOTIFICATION_SHORT_DESCRIPTION_MAX_CHARS),
  markdownContent: markdownContentSchema,
  icon: z.string().optional().refine((value) => {
    if (value === undefined) {
      return true;
    }
    const bytes = decodePngDataUrl(value);
    return bytes !== null && hasPngSignature(bytes);
  }, "Icon must be a PNG data URL no larger than 100 KiB"),
}).strict();

export type WebhookNotificationRequest = z.infer<typeof webhookNotificationRequestSchema>;
