type ListenAppBadgeNavigator = {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

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
  if (!badgeNavigator.setAppBadge && !badgeNavigator.clearAppBadge) {
    return;
  }

  try {
    if (unreadCount > 0) {
      await badgeNavigator.setAppBadge?.(unreadCount);
      return;
    }
    if (badgeNavigator.clearAppBadge) {
      await badgeNavigator.clearAppBadge();
      return;
    }
    await badgeNavigator.setAppBadge?.(0);
  } catch (error) {
    console.warn(`Could not update app badge from ${warningSource}`, { error });
  }
}

(globalThis as typeof globalThis & { listenUpdateAppBadge: ListenAppBadgeUpdater }).listenUpdateAppBadge = listenUpdateAppBadge;
