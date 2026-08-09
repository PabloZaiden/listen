import { updateAppBadge } from "./app-badge-core";

function warn(message: string, error: unknown): void {
  console.warn(message, { error });
}

function parseUnreadCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

async function updateAppBadgeFromPush(unreadCount: number | undefined): Promise<void> {
  if (unreadCount === undefined) {
    return;
  }

  await updateAppBadge(navigator, unreadCount, "browser push", warn);
}

self.addEventListener("push", (event) => {
  let rawPayload;
  try {
    const parsed = event.data?.json();
    rawPayload = typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch (error) {
    warn("Could not parse browser push payload", error);
  }

  const rawTitle = rawPayload?.title;
  const rawBody = rawPayload?.body;
  const rawIcon = rawPayload?.icon;
  const rawBadge = rawPayload?.badge;
  const rawTag = rawPayload?.tag;
  const rawUnreadCount = rawPayload?.unreadCount;
  const rawData = rawPayload?.data;
  const rawUrl = rawData?.url;
  const url = typeof rawUrl === "string" && rawUrl.trim().length > 0 ? rawUrl : undefined;
  const title = typeof rawTitle === "string" && rawTitle.trim().length > 0 ? rawTitle : "Listen notification";
  const body = typeof rawBody === "string" && rawBody.trim().length > 0 ? rawBody : "A new notification arrived.";
  const options = {
    body,
    icon: typeof rawIcon === "string" && rawIcon.trim().length > 0 ? rawIcon : undefined,
    badge: typeof rawBadge === "string" && rawBadge.trim().length > 0 ? rawBadge : undefined,
    tag: typeof rawTag === "string" && rawTag.trim().length > 0 ? rawTag : undefined,
    data: url ? { url } : {},
  };

  event.waitUntil(Promise.all([
    updateAppBadgeFromPush(parseUnreadCount(rawUnreadCount)),
    self.registration.showNotification(title, options),
  ]).then(() => undefined));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data;
  const rawUrl = data?.url;
  const fallback = "/";
  let targetUrl = fallback;
  if (typeof rawUrl === "string" && rawUrl.trim().length > 0) {
    try {
      const parsed = new URL(rawUrl, self.location.origin);
      targetUrl = parsed.origin === self.location.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
    } catch (error) {
      warn("Could not parse notification click URL", error);
    }
  }

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existingClient = windowClients.find((client) => new URL(client.url).origin === self.location.origin);

    if (existingClient) {
      const navigatedClient = await existingClient.navigate(targetUrl);
      if (navigatedClient) {
        await navigatedClient.focus();
        return;
      }
      await existingClient.focus();
      return;
    }

    await self.clients.openWindow(targetUrl);
  })());
});
