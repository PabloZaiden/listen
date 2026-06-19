type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

function badgeNavigator(): BadgeNavigator {
  return navigator as BadgeNavigator;
}

export async function updateAppBadge(unreadCount: number): Promise<void> {
  const badge = badgeNavigator();
  try {
    if (unreadCount > 0) {
      await badge.setAppBadge?.(unreadCount);
      return;
    }
    if (badge.clearAppBadge) {
      await badge.clearAppBadge();
      return;
    }
    await badge.setAppBadge?.(0);
  } catch (error) {
    console.warn("Could not update app badge", { error });
  }
}

export async function clearAppBadge(): Promise<void> {
  await updateAppBadge(0);
}
