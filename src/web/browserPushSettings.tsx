import React, { useCallback, useEffect, useState } from "react";
import type { BrowserPushConfigResponse, BrowserPushStatusResponse, BrowserPushSubscription } from "@listen/contracts";
import { appFetch } from "@listen/client-sdk";
import { ActionMenu } from "./ui/ActionMenu";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";

type BrowserPushUiState = "loading" | "unsupported" | "denied" | "unsubscribed" | "subscribed" | "error";

interface BrowserPushState {
  status: BrowserPushUiState;
  busy: boolean;
  message?: string;
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await appFetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  return response.json() as Promise<T>;
}

function browserSupportsPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

export function applicationServerKeyMatches(subscription: PushSubscription, applicationServerKey: Uint8Array): boolean {
  const existingKey = subscription.options.applicationServerKey;
  if (!existingKey) {
    return false;
  }
  const existingBytes = new Uint8Array(existingKey);
  if (existingBytes.length !== applicationServerKey.length) {
    return false;
  }
  return existingBytes.every((byte, index) => byte === applicationServerKey[index]);
}

function toBrowserPushSubscription(subscription: PushSubscription): BrowserPushSubscription {
  const serialized = subscription.toJSON();
  const endpoint = serialized.endpoint;
  const p256dh = serialized.keys?.["p256dh"];
  const auth = serialized.keys?.["auth"];
  if (!endpoint || !p256dh || !auth) {
    throw new Error("Browser push subscription is missing required keys");
  }
  return {
    endpoint,
    expirationTime: serialized.expirationTime ?? null,
    keys: { p256dh, auth },
  };
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/service-worker", { scope: "/" });
  return navigator.serviceWorker.ready;
}

async function getApplicationServerKey(signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  return base64UrlToUint8Array((await apiJson<BrowserPushConfigResponse>("/api/browser-push/config", { signal })).publicKey);
}

async function saveSubscription(subscription: PushSubscription, signal?: AbortSignal): Promise<void> {
  await apiJson<BrowserPushStatusResponse>("/api/browser-push/subscriptions", {
    method: "POST",
    signal,
    body: JSON.stringify({ subscription: toBrowserPushSubscription(subscription) }),
  });
}

async function deleteSavedSubscription(subscription: PushSubscription, signal?: AbortSignal): Promise<void> {
  await apiJson<BrowserPushStatusResponse>("/api/browser-push/subscriptions", {
    method: "DELETE",
    signal,
    body: JSON.stringify({ endpoint: toBrowserPushSubscription(subscription).endpoint }),
  });
}

async function ensureCurrentBrowserPushSubscription(
  registration: ServiceWorkerRegistration,
  applicationServerKey: Uint8Array<ArrayBuffer>,
  signal?: AbortSignal,
): Promise<PushSubscription> {
  const existing = await registration.pushManager.getSubscription();
  if (existing && applicationServerKeyMatches(existing, applicationServerKey)) {
    return existing;
  }
  if (existing) {
    await deleteSavedSubscription(existing, signal);
    await existing.unsubscribe();
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
}

function useBrowserPushSettings(): [BrowserPushState, { subscribe: () => Promise<boolean>; unsubscribe: () => Promise<boolean>; refresh: () => Promise<void> }] {
  const [state, setState] = useState<BrowserPushState>({ status: "loading", busy: false });

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!browserSupportsPush()) {
      setState({ status: "unsupported", busy: false });
      return;
    }
    if (Notification.permission === "denied") {
      setState({ status: "denied", busy: false });
      return;
    }

    const registration = await registerServiceWorker();
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      setState({ status: "unsubscribed", busy: false });
      return;
    }

    const applicationServerKey = await getApplicationServerKey(signal);
    if (!applicationServerKeyMatches(subscription, applicationServerKey)) {
      subscription = await ensureCurrentBrowserPushSubscription(registration, applicationServerKey, signal);
    }

    const payload = toBrowserPushSubscription(subscription);
    const lookup = await apiJson<BrowserPushStatusResponse>("/api/browser-push/subscriptions/lookup", {
      method: "POST",
      signal,
      body: JSON.stringify({ endpoint: payload.endpoint }),
    });
    if (!lookup.subscribed) {
      await saveSubscription(subscription, signal);
    }
    setState({ status: "subscribed", busy: false });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", busy: false });
    void refresh(controller.signal).catch((error) => {
      if (!controller.signal.aborted) {
        setState({ status: "error", busy: false, message: error instanceof Error ? error.message : String(error) });
      }
    });
    return () => controller.abort();
  }, [refresh]);

  const subscribe = useCallback(async () => {
    setState((current) => ({ ...current, busy: true, message: undefined }));
    try {
      if (!browserSupportsPush()) {
        setState({ status: "unsupported", busy: false });
        return false;
      }
      if (Notification.permission !== "granted") {
        const permission = await Notification.requestPermission();
        if (permission === "denied") {
          setState({ status: "denied", busy: false });
          return false;
        }
        if (permission !== "granted") {
          setState({ status: "unsubscribed", busy: false, message: "Notification permission was not granted." });
          return false;
        }
      }

      const registration = await registerServiceWorker();
      const subscription = await ensureCurrentBrowserPushSubscription(registration, await getApplicationServerKey());
      await saveSubscription(subscription);
      setState({ status: "subscribed", busy: false });
      return true;
    } catch (error) {
      setState({ status: "error", busy: false, message: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setState((current) => ({ ...current, busy: true, message: undefined }));
    try {
      if (!browserSupportsPush()) {
        setState({ status: "unsupported", busy: false });
        return false;
      }
      const registration = await registerServiceWorker();
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        setState({ status: "unsubscribed", busy: false });
        return false;
      }
      const payload = toBrowserPushSubscription(subscription);
      await apiJson<BrowserPushStatusResponse>("/api/browser-push/subscriptions", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: payload.endpoint }),
      });
      await subscription.unsubscribe();
      setState({ status: "unsubscribed", busy: false });
      return true;
    } catch (error) {
      setState({ status: "error", busy: false, message: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }, []);

  return [state, { subscribe, unsubscribe, refresh: () => refresh() }];
}

export function BrowserPushSettings({ onEnabled, onDisabled }: { onEnabled?: () => void; onDisabled?: () => void }): React.ReactElement {
  const [state, actions] = useBrowserPushSettings();

  async function subscribe(): Promise<void> {
    if (await actions.subscribe()) {
      onEnabled?.();
    }
  }

  async function unsubscribe(): Promise<void> {
    if (await actions.unsubscribe()) {
      onDisabled?.();
    }
  }

  const statusText = {
    loading: "Checking this browser...",
    unsupported: "This browser does not support web push notifications here.",
    denied: "Notifications are blocked for this browser. Enable them in the browser or OS settings first.",
    unsubscribed: "This browser is not receiving Listen notifications.",
    subscribed: "This browser is receiving Listen notifications.",
    error: "Could not update browser notifications.",
  }[state.status];

  const primaryAction = state.status === "subscribed" ? (
    <Button type="button" onClick={() => void unsubscribe()} disabled={state.busy}>
      {state.busy ? "Disabling..." : "Disable on this browser"}
    </Button>
  ) : (
    <Button type="button" variant="primary" onClick={() => void subscribe()} disabled={state.busy || state.status === "loading" || state.status === "unsupported" || state.status === "denied"}>
      {state.busy ? "Enabling..." : "Enable on this browser"}
    </Button>
  );

  return (
    <section className="settings-card browser-push-settings" aria-live="polite">
      <div>
        <div className="settings-card-title-row">
          <h3>Browser notifications</h3>
          <Badge variant={state.status === "subscribed" ? "success" : state.status === "denied" ? "danger" : "info"}>{state.status}</Badge>
        </div>
        <p>{statusText}</p>
        {state.status === "unsupported" ? (
          <p className="muted">On iPhone or iPad, install Listen to the Home Screen and open it from there before subscribing. Production notifications require HTTPS; localhost works for development.</p>
        ) : null}
        {state.message ? <p className="error">{state.message}</p> : null}
      </div>
      <div className="settings-card-actions">
        {state.status === "error" ? (
          <ActionMenu label="Browser notification actions">
            {primaryAction}
            <Button type="button" variant="ghost" onClick={() => void actions.refresh()}>Retry</Button>
          </ActionMenu>
        ) : primaryAction}
      </div>
    </section>
  );
}
