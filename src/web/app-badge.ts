import { createLogger } from "@pablozaiden/webapp/web";
import { updateAppBadge, type ListenAppBadgeNavigator } from "./app-badge-core";

const log = createLogger("app-badge");

type ListenAppBadgeUpdater = (
  badgeNavigator: ListenAppBadgeNavigator,
  unreadCount: number,
  warningSource: string,
) => Promise<void>;

export async function listenUpdateAppBadge(
  badgeNavigator: ListenAppBadgeNavigator,
  unreadCount: number,
  warningSource: string,
): Promise<void> {
  await updateAppBadge(badgeNavigator, unreadCount, warningSource, (message, error) => {
    log.warn(message, { error });
  });
}

(globalThis as typeof globalThis & { listenUpdateAppBadge: ListenAppBadgeUpdater }).listenUpdateAppBadge = listenUpdateAppBadge;
