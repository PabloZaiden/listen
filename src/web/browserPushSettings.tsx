import React, { useCallback, useEffect, useState } from "react";
import type { BrowserPushConfigResponse, BrowserPushStatusResponse, BrowserPushSubscription, BrowserPushSubscriptionResponse } from "@listen/contracts";
import { appJson, Button, FormGroup, FormSection, useToast } from "@pablozaiden/webapp/web";
import { mutationErrorMessage, useMutationTracker } from "./mutation-state";

type BrowserPushUiState = "loading" | "unsupported" | "denied" | "unsubscribed" | "subscribed" | "error";

interface BrowserPushState {
  status: BrowserPushUiState;
  busy: boolean;
  message?: string;
}

function browserSupportsPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function browserPushErrorSummary(message: string): string {
  if (message.toLowerCase().includes("serviceworker")) {
    return "Browser notifications could not start the service worker.";
  }
  return "Browser notifications could not be enabled.";
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
  return base64UrlToUint8Array((await appJson<BrowserPushConfigResponse>("/api/browser-push/config", { signal })).publicKey);
}

async function saveSubscription(subscription: PushSubscription, signal?: AbortSignal): Promise<void> {
  await appJson<BrowserPushSubscriptionResponse>("/api/browser-push/subscriptions", {
    method: "POST",
    signal,
    body: JSON.stringify({ subscription: toBrowserPushSubscription(subscription) }),
  });
}

async function deleteSavedSubscription(subscription: PushSubscription, signal?: AbortSignal): Promise<void> {
  await appJson<BrowserPushStatusResponse>("/api/browser-push/subscriptions", {
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
  const { start, finish } = useMutationTracker();

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
    const lookup = await appJson<BrowserPushStatusResponse>("/api/browser-push/subscriptions/lookup", {
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

  const refreshNow = useCallback(async () => {
    const mutationKey = "browser-push";
    if (!start(mutationKey)) return;
    setState((current) => ({ ...current, status: "loading", busy: true, message: undefined }));
    try {
      await refresh();
    } catch (error) {
      const message = mutationErrorMessage(error, "Could not refresh browser notification status.");
      setState({ status: "error", busy: false, message });
      throw error;
    } finally {
      finish(mutationKey);
    }
  }, [finish, refresh, start]);

  const subscribe = useCallback(async () => {
    const mutationKey = "browser-push";
    if (!start(mutationKey)) return false;
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
      const message = mutationErrorMessage(error, "Could not enable browser notifications.");
      setState({ status: "error", busy: false, message });
      throw error;
    } finally {
      finish(mutationKey);
    }
  }, [finish, start]);

  const unsubscribe = useCallback(async () => {
    const mutationKey = "browser-push";
    if (!start(mutationKey)) return false;
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
      await appJson<BrowserPushStatusResponse>("/api/browser-push/subscriptions", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: payload.endpoint }),
      });
      await subscription.unsubscribe();
      setState({ status: "unsubscribed", busy: false });
      return true;
    } catch (error) {
      const message = mutationErrorMessage(error, "Could not disable browser notifications.");
      setState({ status: "error", busy: false, message });
      throw error;
    } finally {
      finish(mutationKey);
    }
  }, [finish, start]);

  return [state, { subscribe, unsubscribe, refresh: refreshNow }];
}

function browserPushDescription(state: BrowserPushState): string {
  switch (state.status) {
    case "loading":
      return "Checking browser notification status...";
    case "unsupported":
      return "This browser does not support web push notifications.";
    case "denied":
      return "Notifications are blocked in this browser.";
    case "subscribed":
      return "This browser receives Listen notifications.";
    case "error":
      return "Listen could not check or update browser notifications.";
    case "unsubscribed":
      return "Enable Listen notifications on this browser.";
  }
}

export function BrowserPushSettings({ onEnabled, onDisabled }: { onEnabled?: () => void; onDisabled?: () => void }): React.ReactElement {
  const toast = useToast();
  const [state, actions] = useBrowserPushSettings();

  async function subscribe(): Promise<void> {
    try {
      if (await actions.subscribe()) {
        onEnabled?.();
        toast.success("Browser notifications enabled.");
      }
    } catch (error) {
      toast.error(mutationErrorMessage(error, "Could not enable browser notifications."));
    }
  }

  async function unsubscribe(): Promise<void> {
    try {
      if (await actions.unsubscribe()) {
        onDisabled?.();
        toast.success("Browser notifications disabled.");
      }
    } catch (error) {
      toast.error(mutationErrorMessage(error, "Could not disable browser notifications."));
    }
  }

  function retry(): void {
    void actions.refresh().catch((error: unknown) => {
      toast.error(mutationErrorMessage(error, "Could not refresh browser notification status."));
    });
  }

  const primaryAction = state.status === "subscribed" ? (
    <Button type="button" onClick={() => { void unsubscribe(); }} loading={state.busy}>
      {state.busy ? "Disabling..." : "Disable on this browser"}
    </Button>
  ) : (
    <Button type="button" variant="primary" onClick={() => { void subscribe(); }} loading={state.busy} disabled={state.status === "loading" || state.status === "unsupported" || state.status === "denied"}>
      {state.busy ? "Enabling..." : "Enable on this browser"}
    </Button>
  );
  const actionControls = state.status === "error" ? (
    <>
      {primaryAction}
      <Button type="button" variant="ghost" onClick={retry} loading={state.busy}>Retry</Button>
    </>
  ) : primaryAction;

  return (
    <FormSection title="Browser notifications">
      <FormGroup title="This browser" description={browserPushDescription(state)} actions={actionControls}>
        {state.message ? (
          <div className="browser-push-error" aria-live="polite">
            <p className="error">{browserPushErrorSummary(state.message)}</p>
            <details>
              <summary>Error details</summary>
              <code>{state.message}</code>
            </details>
          </div>
        ) : null}
      </FormGroup>
    </FormSection>
  );
}
