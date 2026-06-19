import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { LogLevelPreferenceResponse, NotificationDetail, NotificationListItem, PasskeyAuthStatusResponse, SourceResponse } from "@listen/contracts";
import type { LogLevelName } from "@listen/shared";
import { appFetch } from "@listen/client-sdk";
import { BrowserPushSettings } from "./browserPushSettings";
import { useWebSocket } from "./hooks/useWebSocket";
import { normalizeMarkdownForDisplay } from "./markdown";
import { LISTEN_VERSION } from "../version";
import "./styles.css";

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

const KILL_SERVER_COUNTDOWN_SECONDS = 15;

function initialView(): View {
  const notificationId = new URLSearchParams(window.location.search).get("notificationId");
  return notificationId ? { name: "detail", id: notificationId } : { name: "list" };
}

function appendHeadLink(rel: string, href: string): void {
  const link = document.createElement("link");
  link.rel = rel;
  link.href = href;
  document.head.append(link);
}

appendHeadLink("manifest", "/manifest.webmanifest");
appendHeadLink("apple-touch-icon", "/icons/apple-touch-icon.png");

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

function computeProgressPercent(countdown: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return (countdown / total) * 100;
}

function useCountdownReload(active: boolean, onComplete: () => void, durationSeconds = KILL_SERVER_COUNTDOWN_SECONDS): { countdown: number; progressPercent: number } {
  const [countdown, setCountdown] = useState(durationSeconds);
  const onCompleteRef = useCallback(onComplete, [onComplete]);

  useEffect(() => {
    if (!active) {
      return;
    }

    setCountdown(durationSeconds);
    const interval = setInterval(() => {
      setCountdown((previous) => {
        const next = previous - 1;
        if (next <= 0) {
          clearInterval(interval);
          onCompleteRef();
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [active, durationSeconds, onCompleteRef]);

  return {
    countdown,
    progressPercent: computeProgressPercent(countdown, durationSeconds),
  };
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
          <article className={`notification ${notification.openedAt ? "read" : "unread"}${notification.icon ? "" : " no-icon"}`} key={notification.id}>
            {notification.icon ? <img src={notification.icon} alt="" /> : null}
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
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    setDetail(undefined);
    setError(undefined);
    void json<{ notification: NotificationDetail }>(`/api/notifications/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((response) => setDetail(response.notification))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => controller.abort();
  }, [id]);

  if (error) {
    return (
      <section className="panel detail">
        <button type="button" onClick={back}>Back</button>
        <p className="error">Could not load notification: {error}</p>
      </section>
    );
  }

  if (!detail) {
    return <section className="panel">Loading...</section>;
  }

  const markdownContent = normalizeMarkdownForDisplay(detail.markdownContent);

  return (
    <section className="panel detail">
      <div className="detail-summary">
        {detail.icon ? <img className="detail-icon" src={detail.icon} alt="" /> : null}
        <div>
          <h2>{detail.title}</h2>
          <p>{detail.shortDescription}</p>
          <small>{detail.source} • {new Date(detail.createdAt).toLocaleString()}</small>
        </div>
      </div>
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
          {markdownContent}
        </ReactMarkdown>
      </div>
      <div className="detail-actions">
        <button type="button" onClick={back}>Back</button>
      </div>
    </section>
  );
}

function LogLevelSettings(): React.ReactElement {
  const [preference, setPreference] = useState<LogLevelPreferenceResponse>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setPreference(await json<LogLevelPreferenceResponse>("/api/preferences/log-level"));
  }, []);

  useEffect(() => {
    void refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [refresh]);

  async function updateLevel(level: LogLevelName): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const response = await json<{ level: LogLevelName }>("/api/preferences/log-level", {
        method: "PUT",
        body: JSON.stringify({ level }),
      });
      setPreference((current) => current ? { ...current, level: response.level } : current);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card" aria-live="polite">
      <div>
        <h3>Log level</h3>
        <p>{preference?.isFromEnv ? "Controlled by LISTEN_LOG_LEVEL." : "Change server log verbosity at runtime."}</p>
        {error ? <p className="error">{error}</p> : null}
      </div>
      <div className="settings-card-actions">
        <select
          aria-label="Log level"
          value={preference?.level ?? "info"}
          onChange={(event) => void updateLevel(event.target.value as LogLevelName)}
          disabled={busy || !preference || preference.isFromEnv}
        >
          {(preference?.availableLevels ?? ["info"]).map((level) => (
            <option key={level} value={level}>{level}</option>
          ))}
        </select>
      </div>
    </section>
  );
}

function SettingsView({ refreshConfig }: { refreshConfig: () => Promise<void> }): React.ReactElement {
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [serverKilled, setServerKilled] = useState(false);
  const [killingServer, setKillingServer] = useState(false);
  const [killError, setKillError] = useState(false);

  const reloadPage = useCallback(() => {
    window.location.reload();
  }, []);
  const { countdown, progressPercent } = useCountdownReload(serverKilled, reloadPage);

  async function killServer(): Promise<void> {
    setKillingServer(true);
    setKillError(false);
    try {
      const response = await appFetch("/api/server/kill", { method: "POST" });
      if (!response.ok) {
        setKillError(true);
        return;
      }
      setServerKilled(true);
    } catch {
      setKillError(true);
    } finally {
      setKillingServer(false);
    }
  }

  return (
    <section className="panel">
      <h2>Settings</h2>
      <div className="settings-actions">
        <button type="button" onClick={() => void json("/api/passkey-auth/logout", { method: "POST" }).then(refreshConfig)}>Logout</button>
        <button type="button" className="danger" onClick={() => confirm("Delete the configured passkey?") && void json("/api/passkey-auth/passkey", { method: "DELETE" }).then(refreshConfig)}>Delete passkey</button>
      </div>
      <LogLevelSettings />
      <BrowserPushSettings />
      <div className="danger-zone">
        <h3>Danger Zone</h3>
        <p className="danger-zone-description">
          Terminate the server process. In containerized environments (k8s), this will restart the container.
        </p>
        {serverKilled ? (
          <div className="shutdown-countdown" aria-live="polite">
            <div className="shutdown-message">Server is shutting down... Reloading in {countdown}s</div>
            <div className="shutdown-progress" aria-hidden="true">
              <div className="shutdown-progress-bar" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        ) : !showKillConfirm ? (
          <button
            type="button"
            className="danger"
            onClick={() => {
              setKillError(false);
              setShowKillConfirm(true);
            }}
            disabled={killingServer}
          >
            Kill server
          </button>
        ) : (
          <div className="confirm-row">
            <span>Are you sure?</span>
            <button type="button" className="danger" onClick={() => void killServer()} disabled={killingServer}>
              {killingServer ? "Killing server..." : "Yes, kill server"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowKillConfirm(false);
                setKillError(false);
              }}
              disabled={killingServer}
            >
              Cancel
            </button>
          </div>
        )}
        {killError ? <p className="error">Failed to kill server. Please try again.</p> : null}
      </div>
    </section>
  );
}

function VersionLegend(): React.ReactElement {
  return <footer className="version-legend">listen {LISTEN_VERSION}</footer>;
}

function App(): React.ReactElement {
  const [config, refreshConfig] = useConfig();
  const [sources, refreshSources] = useSources();
  const [notifications, setNotifications] = useState<NotificationListItem[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [view, setView] = useState<View>(initialView);
  const homeRefreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const authenticated = Boolean(config?.passkeyAuth.authenticated);
  const ws = useWebSocket(authenticated ? "/api/ws" : undefined);

  const refreshNotifications = useCallback(async () => {
    const query = sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : "";
    setNotifications((await json<{ notifications: NotificationListItem[] }>(`/api/notifications${query}`)).notifications);
  }, [sourceId]);

  const refreshHome = useCallback(async () => {
    await Promise.all([refreshSources(), refreshNotifications()]);
  }, [refreshSources, refreshNotifications]);

  const queueHomeRefresh = useCallback(() => {
    if (homeRefreshTimer.current) {
      return;
    }
    homeRefreshTimer.current = setTimeout(() => {
      homeRefreshTimer.current = undefined;
      void refreshHome();
    }, 0);
  }, [refreshHome]);

  const showHome = useCallback(() => {
    setView({ name: "list" });
    window.history.replaceState(null, "", window.location.pathname);
    queueHomeRefresh();
  }, [queueHomeRefresh]);

  useEffect(() => {
    if (authenticated) {
      void refreshHome();
    }
  }, [authenticated, refreshHome]);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    const refreshWhenVisible = (): void => {
      if (document.visibilityState === "visible") {
        queueHomeRefresh();
      }
    };
    const refreshWhenFocused = (): void => {
      queueHomeRefresh();
    };

    window.addEventListener("focus", refreshWhenFocused);
    window.addEventListener("pageshow", refreshWhenFocused);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.removeEventListener("focus", refreshWhenFocused);
      window.removeEventListener("pageshow", refreshWhenFocused);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      if (homeRefreshTimer.current) {
        clearTimeout(homeRefreshTimer.current);
        homeRefreshTimer.current = undefined;
      }
    };
  }, [authenticated, queueHomeRefresh]);

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

  if (!config) {
    return <main className="app"><div className="auth-card">Loading Listen...</div><VersionLegend /></main>;
  }
  if (!authenticated) {
    return <main className="app"><AuthGate config={config} onAuthenticated={refreshConfig} /><VersionLegend /></main>;
  }

  return (
    <main className="app">
      <header>
        <button type="button" className="brand-button" onClick={showHome}>Listen</button>
        <nav>
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
      {view.name === "settings" ? <SettingsView refreshConfig={refreshConfig} /> : null}
      <VersionLegend />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
