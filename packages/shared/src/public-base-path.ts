export function ensureRootPath(pathname: string): string {
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}
