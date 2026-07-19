export function errorLogFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (typeof error === "object" && error !== null) {
    return { error: redactLogValue(error) };
  }
  return { error: String(error) };
}

function redactLogValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactLogValue);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    shouldRedactLogKey(key) ? "[redacted]" : redactLogValue(entry),
  ]));
}

function shouldRedactLogKey(key: string): boolean {
  return /token|cookie|authorization|auth|passkey|credential|secret|private|publickey|p256dh/i.test(key);
}
