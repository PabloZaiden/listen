interface ListenPushPayload {
  title?: unknown;
  body?: unknown;
  icon?: unknown;
  badge?: unknown;
  tag?: unknown;
  unreadCount?: unknown;
  data?: ListenNotificationData | null;
}

interface ListenNotificationData {
  url?: unknown;
}

interface ListenPushEvent extends Event {
  data?: {
    json(): ListenPushPayload;
  };
  waitUntil(promise: PromiseLike<unknown>): void;
}

interface ListenNotificationClickEvent extends Event {
  notification: {
    data?: ListenNotificationData | null;
    close(): void;
  };
  waitUntil(promise: PromiseLike<unknown>): void;
}

interface ListenWindowClient {
  url: string;
  focus(): Promise<ListenWindowClient>;
  navigate(url: string): Promise<ListenWindowClient | null>;
}

interface ListenClients {
  matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<ListenWindowClient[]>;
  openWindow(url: string): Promise<ListenWindowClient | null>;
}

interface ListenServiceWorkerRegistration {
  showNotification(title: string, options?: NotificationOptions): Promise<void>;
}

interface Window {
  registration: ListenServiceWorkerRegistration;
  clients: ListenClients;
  navigator: Navigator & {
    setAppBadge?: (contents?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  addEventListener(type: "push", listener: (event: ListenPushEvent) => void): void;
  addEventListener(type: "notificationclick", listener: (event: ListenNotificationClickEvent) => void): void;
}
