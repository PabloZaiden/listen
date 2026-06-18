import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { NotificationDetail, NotificationListItem, PasskeyAuthStatusResponse, SourceResponse } from "@listen/contracts";
import { appFetch } from "@listen/client-sdk";
import { useWebSocket } from "./hooks/useWebSocket";

interface AppConfig {
  appName: string;
  passkeyAuth: PasskeyAuthStatusResponse;
}

type View = { name: "list" } | { name: "detail"; id: string } | { name: "sources" } | { name: "settings" };
type RealtimeEvent =
  | { type: "notification.created"; notification: NotificationListItem }
  | { type: "notification.opened"; notification: NotificationListItem }
  | { type: "notification.deleted"; notificationId: string; sourceId?: string }
  | { type: "notifications.deleted"; sourceId?: string; deletedCount: number }
  | { type: "source.created"; source: SourceResponse }
  | { type: "source.updated"; source: SourceResponse }
  | { type: "source.deleted"; sourceId: string }
  | { type: "connected"; sourceId: string | null }
  | { type: "pong" };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await appFetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  return response.json() as Promise<T>;
}

function useConfig(): [AppConfig | undefined, () => Promise<void>] {
  const [config, setConfig] = useState<AppConfig>();
  const refresh = useCallback(async () => {
    setConfig(await json<AppConfig>("/api/config"));
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return [config, refresh];
}

function AuthGate({ config, onAuthenticated }: { config: AppConfig; onAuthenticated: () => Promise<void> }): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function register(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const optionsJSON = await json<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/api/passkey-auth/registration/options");
      const credential = await startRegistration({ optionsJSON });
      await json("/api/passkey-auth/registration/verify", { method: "POST", body: JSON.stringify(credential) });
      await onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function authenticate(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const optionsJSON = await json<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/passkey-auth/authentication/options");
      const credential = await startAuthentication({ optionsJSON });
      await json("/api/passkey-auth/authentication/verify", { method: "POST", body: JSON.stringify(credential) });
      await onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (config.passkeyAuth.passkeyDisabled) {
    return (
      <div className="auth-card">
        <h1>Listen</h1>
        <p className="warning">Passkey protection is disabled by LISTEN_DISABLE_PASSKEY.</p>
        <button type="button" onClick={() => void onAuthenticated()}>Continue</button>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <h1>Listen</h1>
      <p>{config.passkeyAuth.passkeyConfigured ? "Unlock with your passkey." : "Set up your first passkey before using Listen."}</p>
      {error ? <p className="error">{error}</p> : null}
      <button type="button" disabled={busy} onClick={() => void (config.passkeyAuth.passkeyConfigured ? authenticate() : register())}>
        {busy ? "Working..." : config.passkeyAuth.passkeyConfigured ? "Unlock with passkey" : "Set up passkey"}
      </button>
    </div>
  );
}

function useSources(): [SourceResponse[], () => Promise<void>] {
  const [sources, setSources] = useState<SourceResponse[]>([]);
  const refresh = useCallback(async () => {
    setSources((await json<{ sources: SourceResponse[] }>("/api/sources")).sources);
  }, []);
  return [sources, refresh];
}

function SourceManager({ sources, refresh }: { sources: SourceResponse[]; refresh: () => Promise<void> }): React.ReactElement {
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState<string>();
  const [error, setError] = useState<string>();

  async function create(): Promise<void> {
    setError(undefined);
    try {
      const response = await json<{ source: SourceResponse; webhookUrl: string }>("/api/sources", { method: "POST", body: JSON.stringify({ name }) });
      setWebhookUrl(response.webhookUrl);
      setName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function rotate(id: string): Promise<void> {
    const response = await json<{ webhookUrl: string }>(`/api/sources/${encodeURIComponent(id)}/token/rotate`, { method: "POST" });
    setWebhookUrl(response.webhookUrl);
    await refresh();
  }

  async function disable(id: string): Promise<void> {
    if (!confirm("Disable this source? Existing notifications will remain.")) {
      return;
    }
    await json(`/api/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <section className="panel">
      <h2>Sources</h2>
      {webhookUrl ? (
        <div className="secret-box">
          <strong>Copy this webhook URL now. It cannot be retrieved later.</strong>
          <code>{webhookUrl}</code>
          <button type="button" onClick={() => void navigator.clipboard.writeText(webhookUrl)}>Copy URL</button>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="row">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Source name" />
        <button type="button" onClick={() => void create()}>Create source</button>
      </div>
      <div className="stack">
        {sources.map((source) => (
          <article className="source-card" key={source.id}>
            <div>
              <strong>{source.name}</strong>
              <small>Created {new Date(source.createdAt).toLocaleString()} {source.lastUsedAt ? `• Last used ${new Date(source.lastUsedAt).toLocaleString()}` : ""}</small>
            </div>
            <div className="actions">
              <button type="button" onClick={() => void rotate(source.id)}>Rotate token</button>
              <button type="button" className="danger" onClick={() => void disable(source.id)}>Disable</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function NotificationList({
  notifications,
  sources,
  sourceId,
  setSourceId,
  openDetail,
  refresh,
}: {
  notifications: NotificationListItem[];
  sources: SourceResponse[];
  sourceId: string;
  setSourceId: (sourceId: string) => void;
  openDetail: (id: string) => void;
  refresh: () => Promise<void>;
}): React.ReactElement {
  async function deleteOne(id: string): Promise<void> {
    if (!confirm("Delete this notification?")) {
      return;
    }
    await json(`/api/notifications/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refresh();
  }

  async function deleteAll(): Promise<void> {
    if (!confirm("Delete all visible notifications?")) {
      return;
    }
    await json(`/api/notifications${sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ""}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Notifications</h2>
        <button type="button" className="danger" onClick={() => void deleteAll()}>Delete all visible</button>
      </div>
      <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
        <option value="">All sources</option>
        {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
      </select>
      <div className="stack">
        {notifications.map((notification) => (
          <article className={`notification ${notification.openedAt ? "read" : "unread"}`} key={notification.id}>
            {notification.icon ? <img src={notification.icon} alt="" /> : <div className="placeholder-icon" />}
            <button type="button" className="link-button" onClick={() => openDetail(notification.id)}>
              <strong>{notification.title}</strong>
              <span>{notification.shortDescription}</span>
              <small>{notification.source} • {new Date(notification.createdAt).toLocaleString()}</small>
            </button>
            <button type="button" className="danger" onClick={() => void deleteOne(notification.id)}>Delete</button>
          </article>
        ))}
        {notifications.length === 0 ? <p className="muted">No notifications yet.</p> : null}
      </div>
    </section>
  );
}

function NotificationDetailView({ id, back }: { id: string; back: () => void }): React.ReactElement {
  const [detail, setDetail] = useState<NotificationDetail>();
  useEffect(() => {
    const controller = new AbortController();
    void json<{ notification: NotificationDetail }>(`/api/notifications/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((response) => setDetail(response.notification));
    return () => controller.abort();
  }, [id]);

  if (!detail) {
    return <section className="panel">Loading...</section>;
  }

  return (
    <section className="panel detail">
      <button type="button" onClick={back}>Back</button>
      {detail.icon ? <img className="detail-icon" src={detail.icon} alt="" /> : null}
      <h2>{detail.title}</h2>
      <p>{detail.shortDescription}</p>
      <small>{detail.source} • {new Date(detail.createdAt).toLocaleString()}</small>
      <div className="markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          allowedElements={undefined}
          urlTransform={(url) => {
            try {
              const parsed = new URL(url, window.location.href);
              return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? url : "";
            } catch {
              return "";
            }
          }}
          components={{
            a: (props) => <a {...props} target="_blank" rel="noreferrer noopener" />,
          }}
        >
          {detail.markdownContent}
        </ReactMarkdown>
      </div>
    </section>
  );
}

function App(): React.ReactElement {
  const [config, refreshConfig] = useConfig();
  const [sources, refreshSources] = useSources();
  const [notifications, setNotifications] = useState<NotificationListItem[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [view, setView] = useState<View>({ name: "list" });

  const authenticated = Boolean(config?.passkeyAuth.authenticated);
  const ws = useWebSocket(authenticated ? "/api/ws" : undefined);

  const refreshNotifications = useCallback(async () => {
    const query = sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : "";
    setNotifications((await json<{ notifications: NotificationListItem[] }>(`/api/notifications${query}`)).notifications);
  }, [sourceId]);

  useEffect(() => {
    if (authenticated) {
      void Promise.all([refreshSources(), refreshNotifications()]);
    }
  }, [authenticated, refreshSources, refreshNotifications]);

  useEffect(() => {
    const event = ws.lastEvent as RealtimeEvent | undefined;
    if (!event) {
      return;
    }
    if (event.type === "notification.created") {
      setNotifications((items) => (!sourceId || event.notification.sourceId === sourceId) ? [event.notification, ...items] : items);
    } else if (event.type === "notification.opened") {
      setNotifications((items) => items.map((item) => item.id === event.notification.id ? event.notification : item));
    } else if (event.type === "notification.deleted") {
      setNotifications((items) => items.filter((item) => item.id !== event.notificationId));
    } else if (event.type === "notifications.deleted") {
      setNotifications((items) => event.sourceId ? items.filter((item) => item.sourceId !== event.sourceId) : []);
    } else if (event.type.startsWith("source.")) {
      void refreshSources();
    }
  }, [ws.lastEvent, sourceId, refreshSources]);

  const liveLabel = useMemo(() => ws.status === "open" ? "Live" : ws.status === "connecting" ? "Reconnecting" : "Offline", [ws.status]);

  if (!config) {
    return <main className="app"><div className="auth-card">Loading Listen...</div></main>;
  }
  if (!authenticated) {
    return <main className="app"><AuthGate config={config} onAuthenticated={refreshConfig} /></main>;
  }

  return (
    <main className="app">
      <header>
        <h1>Listen</h1>
        <span className={`live ${ws.status}`}>{liveLabel}</span>
        <nav>
          <button type="button" onClick={() => setView({ name: "list" })}>Inbox</button>
          <button type="button" onClick={() => setView({ name: "sources" })}>Sources</button>
          <button type="button" onClick={() => setView({ name: "settings" })}>Settings</button>
        </nav>
      </header>
      {view.name === "list" ? (
        <NotificationList
          notifications={notifications}
          sources={sources}
          sourceId={sourceId}
          setSourceId={setSourceId}
          openDetail={(id) => setView({ name: "detail", id })}
          refresh={refreshNotifications}
        />
      ) : null}
      {view.name === "detail" ? <NotificationDetailView id={view.id} back={() => setView({ name: "list" })} /> : null}
      {view.name === "sources" ? <SourceManager sources={sources} refresh={refreshSources} /> : null}
      {view.name === "settings" ? (
        <section className="panel">
          <h2>Settings</h2>
          <button type="button" onClick={() => void json("/api/passkey-auth/logout", { method: "POST" }).then(refreshConfig)}>Logout</button>
          <button type="button" className="danger" onClick={() => confirm("Delete the configured passkey?") && void json("/api/passkey-auth/passkey", { method: "DELETE" }).then(refreshConfig)}>Delete passkey</button>
        </section>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
