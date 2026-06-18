export function appWebSocketUrl(pathname = "/api/ws"): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${pathname}`;
}
