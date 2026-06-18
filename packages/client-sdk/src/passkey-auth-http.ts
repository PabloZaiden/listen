import { ApiError } from "./api-error";

export type AuthRequiredListener = () => void;

const authRequiredListeners = new Set<AuthRequiredListener>();

export function onAuthRequired(listener: AuthRequiredListener): () => void {
  authRequiredListeners.add(listener);
  return () => authRequiredListeners.delete(listener);
}

export async function appFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...init?.headers,
    },
  });

  if (response.headers.get("x-passkey-auth-required") === "true") {
    for (const listener of authRequiredListeners) {
      listener();
    }
  }

  if (!response.ok) {
    let body: { error?: string; message?: string; details?: unknown } | undefined;
    try {
      body = await response.clone().json() as typeof body;
    } catch {
      body = undefined;
    }
    throw new ApiError(body?.message ?? `Request failed with status ${response.status}`, response.status, body?.error, body?.details);
  }

  return response;
}
