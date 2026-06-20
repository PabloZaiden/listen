export type AppRoute =
  | { name: "inbox" }
  | { name: "notification"; id: string }
  | { name: "sources" }
  | { name: "settings" };

export interface ParsedRoute {
  route: AppRoute;
  error?: string;
}

export function parseAppRoute(pathname: string): ParsedRoute {
  if (pathname === "/") {
    return { route: { name: "inbox" } };
  }
  if (pathname === "/sources") {
    return { route: { name: "sources" } };
  }
  if (pathname === "/settings") {
    return { route: { name: "settings" } };
  }

  const notificationMatch = /^\/notifications\/([^/]+)$/.exec(pathname);
  if (notificationMatch) {
    const id = decodeURIComponent(notificationMatch[1] ?? "").trim();
    if (id.length > 0) {
      return { route: { name: "notification", id } };
    }
  }

  return {
    route: { name: "inbox" },
    error: "That notification link is invalid.",
  };
}

export function routePath(route: AppRoute): string {
  switch (route.name) {
    case "inbox":
      return "/";
    case "notification":
      return `/notifications/${encodeURIComponent(route.id)}`;
    case "sources":
      return "/sources";
    case "settings":
      return "/settings";
  }
}
