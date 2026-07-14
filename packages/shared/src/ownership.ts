export function requireUserId(userId: string): string {
  if (typeof userId !== "string" || userId.trim().length === 0) {
    throw new Error("User ID must be non-empty");
  }
  return userId;
}
