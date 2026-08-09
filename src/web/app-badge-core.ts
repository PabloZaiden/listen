export type ListenAppBadgeNavigator = {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export type ListenAppBadgeWarningHandler = (message: string, error: unknown) => void;

export async function updateAppBadge(
  badgeNavigator: ListenAppBadgeNavigator,
  unreadCount: number,
  warningSource: string,
  onWarning: ListenAppBadgeWarningHandler,
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
    onWarning(`Could not update app badge from ${warningSource}`, error);
  }
}
