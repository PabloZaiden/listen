const SECURITY_HEADERS = [
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["x-frame-options", "DENY"],
  ["content-security-policy", "frame-ancestors 'none'"],
] as const;

export function applySecurityHeaders(headers: Headers): Headers {
  for (const [name, value] of SECURITY_HEADERS) {
    if (!headers.has(name)) {
      headers.set(name, value);
    }
  }
  return headers;
}

export function withSecurityHeaders(response: Response): Response {
  applySecurityHeaders(response.headers);
  return response;
}
