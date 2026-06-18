export interface RequestOrigin {
  protocol: string;
  host: string;
  origin: string;
  rpID: string;
  secure: boolean;
}

function lastHeaderValue(value: string | null): string | undefined {
  const values = value?.split(",").map((entry) => entry.trim()).filter(Boolean);
  return values?.at(-1);
}

function getRpID(host: string): string {
  const normalizedHost = host.trim();
  if (normalizedHost.startsWith("[")) {
    const closingBracket = normalizedHost.indexOf("]");
    if (closingBracket > 1) {
      return normalizedHost.slice(1, closingBracket);
    }
  }
  try {
    const hostname = new URL(`http://${normalizedHost}`).hostname;
    return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  } catch {
    return normalizedHost.indexOf(":") !== normalizedHost.lastIndexOf(":")
      ? normalizedHost
      : normalizedHost.split(":")[0] ?? normalizedHost;
  }
}

export function getRequestOrigin(req: Request): RequestOrigin {
  const url = new URL(req.url);
  const protocol = lastHeaderValue(req.headers.get("x-forwarded-proto")) ?? url.protocol.replace(":", "");
  const host = lastHeaderValue(req.headers.get("x-forwarded-host")) ?? req.headers.get("host") ?? url.host;
  const origin = `${protocol}://${host}`;
  return {
    protocol,
    host,
    origin,
    rpID: getRpID(host),
    secure: protocol === "https",
  };
}
