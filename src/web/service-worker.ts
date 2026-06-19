interface ListenPushPayload {
  title?: unknown;
  body?: unknown;
  icon?: unknown;
  badge?: unknown;
  tag?: unknown;
  data?: unknown;
}

interface ListenNotificationData {
  url?: unknown;
}

interface ListenPushEvent extends Event {
  data?: {
    json(): unknown;
  };
  waitUntil(promise: Promise<unknown>): void;
}

interface ListenNotificationClickEvent extends Event {
  notification: {
    data?: unknown;
    close(): void;
  };
  waitUntil(promise: Promise<unknown>): void;
}

interface ListenWindowClient {
  url: string;
  focus(): Promise<ListenWindowClient>;
  navigate(url: string): Promise<ListenWindowClient | null>;
}

interface ListenServiceWorkerScope {
  location: Location;
  registration: {
    showNotification(title: string, options?: NotificationOptions): Promise<void>;
  };
  clients: {
    matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<ListenWindowClient[]>;
    openWindow(url: string): Promise<ListenWindowClient | null>;
  };
  addEventListener(type: "push", listener: (event: ListenPushEvent) => void): void;
  addEventListener(type: "notificationclick", listener: (event: ListenNotificationClickEvent) => void): void;
}

const serviceWorker = self as unknown as ListenServiceWorkerScope;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function notificationData(value: unknown): ListenNotificationData {
  return isRecord(value) ? { url: stringValue(value["url"]) } : {};
}

function parsePayload(event: ListenPushEvent): Required<Pick<NotificationOptions, "data">> & {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
} {
  let rawPayload: ListenPushPayload | undefined;
  try {
    const parsed = event.data?.json();
    rawPayload = isRecord(parsed) ? parsed : undefined;
  } catch (error) {
    console.warn("Could not parse browser push payload", { error });
  }

  return {
    title: stringValue(rawPayload?.title) ?? "Listen notification",
    body: stringValue(rawPayload?.body) ?? "A new notification arrived.",
    icon: stringValue(rawPayload?.icon),
    badge: stringValue(rawPayload?.badge),
    tag: stringValue(rawPayload?.tag),
    data: notificationData(rawPayload?.data),
  };
}

function normalizeAppUrl(rawUrl: unknown): string {
  const fallback = "/";
  const value = stringValue(rawUrl) ?? fallback;
  try {
    const parsed = new URL(value, serviceWorker.location.origin);
    if (parsed.origin !== serviceWorker.location.origin) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (error) {
    console.warn("Could not parse notification click URL", { error });
    return fallback;
  }
}

async function openOrFocusApp(url: string): Promise<void> {
  const clients = await serviceWorker.clients.matchAll({ type: "window", includeUncontrolled: true });
  const existingClient = clients.find((client) => new URL(client.url).origin === serviceWorker.location.origin);
  if (existingClient) {
    await existingClient.navigate(url);
    await existingClient.focus();
    return;
  }
  await serviceWorker.clients.openWindow(url);
}

serviceWorker.addEventListener("push", (event) => {
  const payload = parsePayload(event);
  event.waitUntil(serviceWorker.registration.showNotification(payload.title, {
    body: payload.body,
    icon: payload.icon,
    badge: payload.badge,
    tag: payload.tag,
    data: payload.data,
  }));
});

serviceWorker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = notificationData(event.notification.data);
  event.waitUntil(openOrFocusApp(normalizeAppUrl(data.url)));
});
