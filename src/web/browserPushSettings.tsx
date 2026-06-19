import React, { useCallback, useEffect, useState } from "react";
import type { BrowserPushConfigResponse, BrowserPushStatusResponse, BrowserPushSubscription } from "@listen/contracts";
import { appFetch } from "@listen/client-sdk";

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

function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
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

async function saveSubscription(subscription: PushSubscription, signal?: AbortSignal): Promise<void> {
  await apiJson<BrowserPushStatusResponse>("/api/browser-push/subscriptions", {
    method: "POST",
    signal,
    body: JSON.stringify({ subscription: toBrowserPushSubscription(subscription) }),
  });
}

function useBrowserPushSettings(): [BrowserPushState, { subscribe: () => Promise<void>; unsubscribe: () => Promise<void>; refresh: () => Promise<void> }] {
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
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      setState({ status: "unsubscribed", busy: false });
      return;
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
        return;
      }
      if (Notification.permission !== "granted") {
        const permission = await Notification.requestPermission();
        if (permission === "denied") {
          setState({ status: "denied", busy: false });
          return;
        }
        if (permission !== "granted") {
          setState({ status: "unsubscribed", busy: false, message: "Notification permission was not granted." });
          return;
        }
      }

      const registration = await registerServiceWorker();
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array((await apiJson<BrowserPushConfigResponse>("/api/browser-push/config")).publicKey),
      });
      await saveSubscription(subscription);
      setState({ status: "subscribed", busy: false });
    } catch (error) {
      setState({ status: "error", busy: false, message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setState((current) => ({ ...current, busy: true, message: undefined }));
    try {
      if (!browserSupportsPush()) {
        setState({ status: "unsupported", busy: false });
        return;
      }
      const registration = await registerServiceWorker();
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        setState({ status: "unsubscribed", busy: false });
        return;
      }
      const payload = toBrowserPushSubscription(subscription);
      await apiJson<BrowserPushStatusResponse>("/api/browser-push/subscriptions", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: payload.endpoint }),
      });
      await subscription.unsubscribe();
      setState({ status: "unsubscribed", busy: false });
    } catch (error) {
      setState({ status: "error", busy: false, message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  return [state, { subscribe, unsubscribe, refresh: () => refresh() }];
}

export function BrowserPushSettings(): React.ReactElement {
  const [state, actions] = useBrowserPushSettings();

  const statusText = {
    loading: "Checking this browser...",
    unsupported: "This browser does not support web push notifications here.",
    denied: "Notifications are blocked for this browser. Enable them in the browser or OS settings first.",
    unsubscribed: "This browser is not receiving Listen notifications.",
    subscribed: "This browser is receiving Listen notifications.",
    error: "Could not update browser notifications.",
  }[state.status];

  return (
    <section className="settings-card browser-push-settings" aria-live="polite">
      <div>
        <h3>Browser notifications</h3>
        <p>{statusText}</p>
        {state.status === "unsupported" ? (
          <p className="muted">On iPhone or iPad, install Listen to the Home Screen and open it from there before subscribing.</p>
        ) : null}
        {state.message ? <p className="error">{state.message}</p> : null}
      </div>
      <div className="settings-card-actions">
        {state.status === "subscribed" ? (
          <button type="button" onClick={() => void actions.unsubscribe()} disabled={state.busy}>
            {state.busy ? "Disabling..." : "Disable on this browser"}
          </button>
        ) : (
          <button type="button" onClick={() => void actions.subscribe()} disabled={state.busy || state.status === "loading" || state.status === "unsupported" || state.status === "denied"}>
            {state.busy ? "Enabling..." : "Enable on this browser"}
          </button>
        )}
        {state.status === "error" ? <button type="button" onClick={() => void actions.refresh()}>Retry</button> : null}
      </div>
    </section>
  );
}
