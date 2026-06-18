import { WEBHOOK_TOKEN_RANDOM_BYTES } from "@listen/shared";

export function generateWebhookToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(WEBHOOK_TOKEN_RANDOM_BYTES))).toString("base64url");
}

export async function hashWebhookToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Buffer.from(hash).toString("hex");
}

export async function verifyWebhookToken(token: string, expectedHash: string): Promise<boolean> {
  const submittedHash = await hashWebhookToken(token);
  const submitted = Buffer.from(submittedHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (submitted.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(submitted, expected);
}
