export interface RequestOrigin {
  protocol: string;
  host: string;
  origin: string;
  rpID: string;
  secure: boolean;
}

function firstHeaderValue(value: string | null): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

export function getRequestOrigin(req: Request): RequestOrigin {
  const url = new URL(req.url);
  const protocol = firstHeaderValue(req.headers.get("x-forwarded-proto")) ?? url.protocol.replace(":", "");
  const host = firstHeaderValue(req.headers.get("x-forwarded-host")) ?? req.headers.get("host") ?? url.host;
  const origin = `${protocol}://${host}`;
  return {
    protocol,
    host,
    origin,
    rpID: host.split(":")[0] ?? host,
    secure: protocol === "https",
  };
}
