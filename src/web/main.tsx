import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { LogLevelPreferenceResponse, NotificationDetail, NotificationListItem, PasskeyAuthStatusResponse, SourceResponse } from "@listen/contracts";
import type { LogLevelName } from "@listen/shared";
import { LIST_NOTIFICATIONS_DEFAULT_LIMIT, NOTIFICATION_SOURCE_NAME_MAX_CHARS } from "@listen/shared";
import { appFetch } from "@listen/client-sdk";
import { clearAppBadge, updateAppBadge } from "./appBadge";
import { BrowserPushSettings } from "./browserPushSettings";
import { useWebSocket } from "./hooks/useWebSocket";
import { filterNotifications } from "./notificationList";
import { normalizeMarkdownForDisplay } from "./markdown";
import { type AppRoute, parseAppRoute, routePath } from "./routes";
import { applyThemePreference, readStoredThemePreference, THEME_STORAGE_KEY, type ThemePreference } from "./theme";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { ConfirmModal } from "./ui/ConfirmModal";
import { EmptyState } from "./ui/EmptyState";
import { Field } from "./ui/Field";
import { IconButton } from "./ui/IconButton";
import { Panel } from "./ui/Panel";
import { useToast } from "./ui/Toast";
import { LISTEN_VERSION } from "../version";
import "./styles.css";

interface AppConfig {
  appName: string;
  passkeyAuth: PasskeyAuthStatusResponse;
}

type RealtimeEvent =
  | { type: "notification.created"; notification: NotificationListItem; unreadCount: number }
  | { type: "notification.opened"; notification: NotificationListItem; unreadCount: number }
  | { type: "notification.deleted"; notificationId: string; sourceId?: string; unreadCount: number }
  | { type: "notifications.deleted"; sourceId?: string; deletedCount: number; unreadCount: number }
  | { type: "notifications.opened"; sourceId?: string; updatedCount: number; unreadCount: number }
  | { type: "source.created"; source: SourceResponse }
  | { type: "source.updated"; source: SourceResponse }
  | { type: "source.deleted"; sourceId: string }
  | { type: "connected"; sourceId: string | null }
  | { type: "pong" };

interface ListNotificationsResponse {
  notifications: NotificationListItem[];
  unreadCount: number;
  pagination: {
    limit: number;
    offset: number;
    total: number;
    nextOffset?: number;
  };
}

interface ConfirmState {
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  cancelLabel?: string;
  action?: () => Promise<void>;
  actions?: ConfirmAction[];
}

interface ConfirmAction {
  label: string;
  danger?: boolean;
  action: () => Promise<void>;
}

interface WebhookResult {
  sourceName: string;
  url: string;
}

const KILL_SERVER_COUNTDOWN_SECONDS = 15;

function appendHeadLink(rel: string, href: string): void {
  if (document.querySelector(`link[rel="${rel}"][href="${href}"]`)) {
    return;
  }
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
  return total <= 0 ? 0 : (countdown / total) * 100;
}

function useCountdownReload(active: boolean, onComplete: () => void, durationSeconds = KILL_SERVER_COUNTDOWN_SECONDS): { countdown: number; progressPercent: number } {
  const [countdown, setCountdown] = useState(durationSeconds);

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
          onComplete();
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [active, durationSeconds, onComplete]);

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

function useSources(): [SourceResponse[], () => Promise<void>] {
  const [sources, setSources] = useState<SourceResponse[]>([]);
  const refresh = useCallback(async () => {
    setSources((await json<{ sources: SourceResponse[] }>("/api/sources")).sources);
  }, []);
  return [sources, refresh];
}

function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredThemePreference());

  useEffect(() => {
    applyThemePreference(preference);
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  }, [preference]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = (): void => applyThemePreference(preference);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preference]);

  return [preference, setPreferenceState];
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
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
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
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (config.passkeyAuth.passkeyDisabled) {
    return (
      <main className="auth-layout">
        <Panel title="Listen" description="Passkey protection is disabled by LISTEN_DISABLE_PASSKEY." className="auth-card">
          <Badge variant="warning">Recovery mode</Badge>
          <Button type="button" variant="primary" onClick={() => void onAuthenticated()}>Continue</Button>
        </Panel>
        <VersionLegend />
      </main>
    );
  }

  return (
    <main className="auth-layout">
      <Panel title="Listen" description={config.passkeyAuth.passkeyConfigured ? "Unlock with your passkey." : "Set up your first passkey before using Listen."} className="auth-card">
        {error ? <p className="error">{error}</p> : null}
        <Button type="button" variant="primary" loading={busy} onClick={() => void (config.passkeyAuth.passkeyConfigured ? authenticate() : register())}>
          {config.passkeyAuth.passkeyConfigured ? "Unlock with passkey" : "Set up passkey"}
        </Button>
      </Panel>
      <VersionLegend />
    </main>
  );
}

function VersionLegend(): React.ReactElement {
  return <footer className="version-legend">listen {LISTEN_VERSION}</footer>;
}

function Icon({ name }: { name: "panel" | "sources" | "settings" }): React.ReactElement {
  if (name === "settings") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="app-icon">
        <path d="M10.33 4.32c.43-1.76 2.91-1.76 3.34 0a1.72 1.72 0 0 0 2.58 1.06c1.54-.94 3.3.83 2.36 2.37a1.72 1.72 0 0 0 1.07 2.57c1.76.43 1.76 2.93 0 3.36a1.72 1.72 0 0 0-1.07 2.57c.94 1.54-.82 3.31-2.36 2.37a1.72 1.72 0 0 0-2.58 1.06c-.43 1.76-2.91 1.76-3.34 0a1.72 1.72 0 0 0-2.58-1.06c-1.54.94-3.3-.83-2.36-2.37a1.72 1.72 0 0 0-1.07-2.57c-1.76-.43-1.76-2.93 0-3.36a1.72 1.72 0 0 0 1.07-2.57c-.94-1.54.82-3.31 2.36-2.37.99.61 2.3.07 2.58-1.06Z" />
        <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      </svg>
    );
  }
  if (name === "sources") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="app-icon">
        <circle cx="6" cy="7" r="2.5" />
        <circle cx="18" cy="7" r="2.5" />
        <circle cx="12" cy="17" r="2.5" />
        <path d="M8.2 8.3 10.8 15" />
        <path d="M15.8 8.3 13.2 15" />
        <path d="M8.6 7h6.8" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="app-icon">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

function isMobileSidebarViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches;
}

function AppShell({
  route,
  sources,
  selectedSourceId,
  onNavigate,
  onSourceFilter,
  children,
}: {
  route: AppRoute;
  sources: SourceResponse[];
  selectedSourceId: string;
  onNavigate: (route: AppRoute) => void;
  onSourceFilter: (sourceId: string) => void;
  children: React.ReactNode;
}): React.ReactElement {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => isMobileSidebarViewport());
  const sidebarRevealButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (sidebarCollapsed || !isMobileSidebarViewport()) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setSidebarCollapsed(true);
        sidebarRevealButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sidebarCollapsed]);

  const closeSidebarOnMobile = (): void => {
    if (isMobileSidebarViewport()) {
      setSidebarCollapsed(true);
    }
  };

  const closeAndNavigate = (nextRoute: AppRoute): void => {
    onNavigate(nextRoute);
    closeSidebarOnMobile();
  };

  const navigationButtons = (): React.ReactNode => (
    <>
      <IconButton type="button" aria-label="Sources" title="Sources" variant={route.name === "sources" ? "secondary" : "ghost"} onClick={() => closeAndNavigate({ name: "sources" })}>
        <Icon name="sources" />
      </IconButton>
      <IconButton type="button" aria-label="Settings" title="Settings" variant={route.name === "settings" ? "secondary" : "ghost"} onClick={() => closeAndNavigate({ name: "settings" })}>
        <Icon name="settings" />
      </IconButton>
    </>
  );

  const sourceList = (
    <div className="source-filter-list">
      <div className="source-filter-heading">Sources</div>
      {sources.map((source) => (
        <button
          type="button"
          className={selectedSourceId === source.id ? "source-filter active" : "source-filter"}
          key={source.id}
          onClick={() => {
            onSourceFilter(source.id);
            closeSidebarOnMobile();
          }}
        >
          <span>{source.name}</span>
          {source.disabledAt ? <Badge variant="disabled">Disabled</Badge> : null}
        </button>
      ))}
    </div>
  );

  return (
    <main className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      <div className="mobile-sidebar-backdrop" onMouseDown={() => { setSidebarCollapsed(true); sidebarRevealButtonRef.current?.focus(); }} />
      <aside className={sidebarCollapsed ? "shell-rail shell-rail-collapsed" : "shell-rail"} aria-hidden={sidebarCollapsed}>
        <div className="rail-header">
          <button type="button" className="brand-button" onClick={() => { onSourceFilter(""); closeSidebarOnMobile(); }}>Listen</button>
          <div className="rail-actions" role="group" aria-label="Sidebar controls">
            {navigationButtons()}
            <IconButton type="button" aria-label="Collapse sidebar" title="Collapse sidebar" variant="ghost" onClick={() => setSidebarCollapsed(true)}>
              <Icon name="panel" />
            </IconButton>
          </div>
        </div>
        {sourceList}
        <VersionLegend />
      </aside>
      {sidebarCollapsed ? (
        <div className="sidebar-reveal-row">
          <IconButton ref={sidebarRevealButtonRef} type="button" aria-label="Show sidebar" title="Show sidebar" variant="ghost" onClick={() => setSidebarCollapsed(false)}>
            <Icon name="panel" />
          </IconButton>
        </div>
      ) : null}
      <section className="shell-content">
        {children}
      </section>
    </main>
  );
}

function InboxView({
  notifications,
  sources,
  selectedSourceId,
  hiddenNewCount,
  pagination,
  loadingMore,
  onOpen,
  onRefresh,
  onLoadMore,
  onDeleteAll,
}: {
  notifications: NotificationListItem[];
  sources: SourceResponse[];
  selectedSourceId: string;
  hiddenNewCount: number;
  pagination?: ListNotificationsResponse["pagination"];
  loadingMore: boolean;
  onOpen: (id: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onDeleteAll: (visible: NotificationListItem[]) => void;
}): React.ReactElement {
  const visible = useMemo(() => filterNotifications(notifications, { filter: "all", sourceId: selectedSourceId, search: "" }), [notifications, selectedSourceId]);
  const selectedSource = sources.find((source) => source.id === selectedSourceId);

  let emptyState = <EmptyState title="No notifications" />;
  if (selectedSource && visible.length === 0) {
    emptyState = <EmptyState title="No notifications for this source" />;
  }

  return (
    <div className="view-stack">
      <div className="view-header">
        <div>
          <h1>Inbox</h1>
        </div>
      </div>

      {hiddenNewCount > 0 ? (
        <div className="notice">{hiddenNewCount} new notification{hiddenNewCount === 1 ? "" : "s"} hidden by the current filters. <button type="button" onClick={onRefresh}>Refresh view</button></div>
      ) : null}

      <Panel>
        {visible.length > 0 ? (
          <div className="notification-list">
            {visible.map((notification) => (
              <article className={`notification-row ${notification.openedAt ? "read" : "unread"}${notification.icon ? "" : " no-icon"}`} key={notification.id}>
                {notification.icon ? <img src={notification.icon} alt="" /> : null}
                <button type="button" className="notification-open" onClick={() => onOpen(notification.id)}>
                  <strong>{notification.title}</strong>
                  <span>{notification.shortDescription}</span>
                </button>
              </article>
            ))}
          </div>
        ) : emptyState}
        {pagination?.nextOffset !== undefined ? (
          <div className="load-more-row">
            <Button type="button" onClick={onLoadMore} loading={loadingMore}>Load more</Button>
            <span className="muted">Showing {notifications.length} of {pagination.total}</span>
          </div>
        ) : null}
        {visible.length > 0 ? (
          <div className="delete-all-row">
            <Button type="button" variant="ghost" onClick={() => onDeleteAll(visible)}>Delete all</Button>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function NotificationDetailView({
  id,
  onBack,
  onDelete,
}: {
  id: string;
  onBack: () => void;
  onDelete: (id: string) => void;
}): React.ReactElement {
  const [detail, setDetail] = useState<NotificationDetail>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setDetail(undefined);
    setError(undefined);
    void json<{ notification: NotificationDetail }>(`/api/notifications/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((response) => setDetail(response.notification))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => controller.abort();
  }, [id]);

  if (error) {
    return (
      <Panel title="Notification not found" className="detail-panel">
        <p className="error">{error}</p>
      </Panel>
    );
  }

  if (!detail) {
    return <Panel className="detail-panel"><div className="loading-card">Loading notification...</div></Panel>;
  }

  const markdownContent = normalizeMarkdownForDisplay(detail.markdownContent);

  return (
    <div className="view-stack">
      <div className="view-header detail-header">
        <div>
          <h1>{detail.title}</h1>
        </div>
      </div>

      <Panel className="detail-panel">
        <div className="detail-summary">
          {detail.icon ? <img className="detail-icon" src={detail.icon} alt="" /> : null}
          <div>
            <h2>{detail.title}</h2>
            <p>{detail.shortDescription}</p>
          </div>
        </div>
        <div className="markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
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
      </Panel>
      <div className="detail-actions-row">
        <Button type="button" variant="danger" onClick={() => onDelete(detail.id)}>Delete</Button>
        <Button type="button" variant="secondary" onClick={onBack}>Back</Button>
      </div>
    </div>
  );
}

function SourcesView({ sources, refreshSources, requestConfirm }: { sources: SourceResponse[]; refreshSources: () => Promise<void>; requestConfirm: (confirm: ConfirmState) => void }): React.ReactElement {
  const [name, setName] = useState("");
  const [webhookResult, setWebhookResult] = useState<WebhookResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const toast = useToast();

  const nameError = name.trim().length > NOTIFICATION_SOURCE_NAME_MAX_CHARS ? `Source names must be ${NOTIFICATION_SOURCE_NAME_MAX_CHARS} characters or fewer.` : undefined;

  async function create(): Promise<void> {
    if (!name.trim() || nameError) {
      setError(nameError ?? "Enter a source name.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const response = await json<{ source: SourceResponse; webhookUrl: string }>("/api/sources", { method: "POST", body: JSON.stringify({ name }) });
      setWebhookResult({ sourceName: response.source.name, url: response.webhookUrl });
      await copyWebhook(response.webhookUrl);
      setName("");
      toast.success("Source created.");
      await refreshSources();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function rotate(source: SourceResponse): void {
    requestConfirm({
      title: "Rotate source token?",
      description: `The old webhook URL for ${source.name} will stop working immediately. Existing notifications remain.`,
      confirmLabel: "Rotate token",
      danger: true,
      action: async () => {
        const response = await json<{ webhookUrl: string }>(`/api/sources/${encodeURIComponent(source.id)}/token/rotate`, { method: "POST" });
        setWebhookResult({ sourceName: source.name, url: response.webhookUrl });
        await copyWebhook(response.webhookUrl);
        toast.success("Source token rotated.");
        await refreshSources();
      },
    });
  }

  function deleteSource(source: SourceResponse): void {
    requestConfirm({
      title: "Delete source?",
      description: `This will delete ${source.name} and all notifications from this source.`,
      confirmLabel: "Delete",
      danger: true,
      action: async () => {
        await json(`/api/sources/${encodeURIComponent(source.id)}`, { method: "DELETE" });
        toast.success("Source deleted.");
        await refreshSources();
      },
    });
  }

  async function copyWebhook(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Webhook URL copied.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  function WebhookBox({ result }: { result: WebhookResult }): React.ReactElement {
    return (
      <div className="secret-box">
        <strong>{`New webhook URL for ${result.sourceName}`}</strong>
        <code>{result.url}</code>
        <div className="row">
          <Button type="button" variant="secondary" onClick={() => void copyWebhook(result.url)}>Copy URL</Button>
          <Button type="button" variant="ghost" onClick={() => setWebhookResult(undefined)}>Dismiss</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="view-stack">
      <div className="view-header">
        <div>
          <h1>Sources</h1>
        </div>
      </div>
      <Panel>
        {webhookResult ? <WebhookBox result={webhookResult} /> : null}
        <div className="source-create-grid">
          <Field label="Source name" htmlFor="source-name" errorText={error ?? nameError} reserveErrorSpace hideLabel>
            <input id="source-name" className="app-input" aria-label="Source name" value={name} onChange={(event) => setName(event.target.value)} placeholder="CI Pipeline" maxLength={NOTIFICATION_SOURCE_NAME_MAX_CHARS + 1} />
          </Field>
          <Button type="button" variant="primary" loading={busy} onClick={() => void create()}>Create source</Button>
        </div>
      </Panel>

      <Panel>
        <div className="source-table">
          {sources.map((source) => (
            <article className="source-card" key={source.id}>
              <div>
                <h3>{source.name}</h3>
              </div>
              <div className="row-actions">
                <Button type="button" size="sm" variant="secondary" onClick={() => rotate(source)}>Rotate token</Button>
                <Button type="button" size="sm" variant="danger" onClick={() => deleteSource(source)}>Delete</Button>
              </div>
            </article>
          ))}
          {sources.length === 0 ? <EmptyState title="No sources" /> : null}
        </div>
      </Panel>
    </div>
  );
}

function LogLevelSettings({ onSaved }: { onSaved: () => void }): React.ReactElement {
  const [preference, setPreference] = useState<LogLevelPreferenceResponse>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setPreference(await json<LogLevelPreferenceResponse>("/api/preferences/log-level"));
  }, []);

  useEffect(() => {
    void refresh().catch((error) => setError(error instanceof Error ? error.message : String(error)));
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
      onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card" aria-live="polite">
      <div>
        <div className="settings-card-title-row">
          <h3>Diagnostics</h3>
          {preference?.isFromEnv ? <Badge variant="warning">Env controlled</Badge> : null}
        </div>
        {error ? <p className="error">{error}</p> : null}
      </div>
      <div className="settings-card-actions">
        <select
          className="app-input"
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

function SettingsView({
  config,
  refreshConfig,
  themePreference,
  setThemePreference,
  requestConfirm,
}: {
  config: AppConfig;
  refreshConfig: () => Promise<void>;
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
  requestConfirm: (confirm: ConfirmState) => void;
}): React.ReactElement {
  const [serverKilled, setServerKilled] = useState(false);
  const [killingServer, setKillingServer] = useState(false);
  const [killError, setKillError] = useState<string>();
  const toast = useToast();

  const reloadPage = useCallback(() => {
    window.location.reload();
  }, []);
  const { countdown, progressPercent } = useCountdownReload(serverKilled, reloadPage);

  function deletePasskey(): void {
    requestConfirm({
      title: "Delete passkey?",
      description: "This removes the configured passkey. You will need to set up a new passkey before protected access is restored.",
      confirmLabel: "Delete passkey",
      danger: true,
      action: async () => {
        await json("/api/passkey-auth/passkey", { method: "DELETE" });
        toast.success("Passkey deleted.");
        await refreshConfig();
      },
    });
  }

  function killServerConfirm(): void {
    requestConfirm({
      title: "Kill server?",
      description: "Listen will return a success response, then terminate this server process so a supervisor or container runtime can restart it.",
      confirmLabel: "Kill server",
      danger: true,
      action: async () => {
        setKillingServer(true);
        setKillError(undefined);
        try {
          const response = await appFetch("/api/server/kill", { method: "POST" });
          if (!response.ok) {
            setKillError("Failed to kill server. Please try again.");
            return;
          }
          toast.success("Server kill requested.");
          setServerKilled(true);
        } catch (error) {
          setKillError(error instanceof Error ? error.message : String(error));
        } finally {
          setKillingServer(false);
        }
      },
    });
  }

  return (
    <div className="view-stack">
      <div className="view-header">
        <div>
          <h1>Settings</h1>
        </div>
      </div>

      <Panel>
        <section className="settings-card">
          <div>
            <div className="settings-card-title-row">
              <h3>Security</h3>
              {config.passkeyAuth.passkeyDisabled ? null : <Badge variant="success">Passkey protected</Badge>}
            </div>
          </div>
          <div className="settings-card-actions">
            <Button type="button" onClick={() => void json("/api/passkey-auth/logout", { method: "POST" }).then(refreshConfig)}>Logout</Button>
            <Button type="button" variant="danger" onClick={deletePasskey}>Delete passkey</Button>
          </div>
        </section>

        <BrowserPushSettings onEnabled={() => toast.success("Browser push enabled.")} onDisabled={() => toast.success("Browser push disabled.")} />

        <section className="settings-card">
          <div>
            <h3>Display</h3>
          </div>
          <div className="segmented-control" role="group" aria-label="Theme preference">
            {(["system", "light", "dark"] as const).map((preference) => (
              <button
                type="button"
                className={themePreference === preference ? "active" : ""}
                key={preference}
                onClick={() => {
                  setThemePreference(preference);
                  toast.success("Display preference saved.");
                }}
              >
                {preference}
              </button>
            ))}
          </div>
        </section>

        <LogLevelSettings onSaved={() => toast.success("Log level updated.")} />

        <section className="settings-card danger-card">
          <div>
            <h3>Server operations</h3>
            {killError ? <p className="error">{killError}</p> : null}
            {serverKilled ? (
              <div className="shutdown-countdown" aria-live="polite">
                <div className="shutdown-message">Server is shutting down... Reloading in {countdown}s</div>
                <div className="shutdown-progress" aria-hidden="true">
                  <div className="shutdown-progress-bar" style={{ width: `${progressPercent}%` }} />
                </div>
              </div>
            ) : null}
          </div>
          <div className="settings-card-actions">
            <Button type="button" variant="danger" onClick={killServerConfirm} loading={killingServer} disabled={serverKilled}>Kill server</Button>
          </div>
        </section>
      </Panel>
    </div>
  );
}

function AppContent(): React.ReactElement {
  const [config, refreshConfig] = useConfig();
  const [sources, refreshSources] = useSources();
  const [notifications, setNotifications] = useState<NotificationListItem[]>([]);
  const [, setUnreadCount] = useState(0);
  const [pagination, setPagination] = useState<ListNotificationsResponse["pagination"]>();
  const [route, setRoute] = useState<AppRoute>(() => parseAppRoute(window.location.pathname).route);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [hiddenNewCount, setHiddenNewCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [themePreference, setThemePreference] = useThemePreference();
  const [confirmState, setConfirmState] = useState<ConfirmState>();
  const [confirming, setConfirming] = useState(false);
  const homeRefreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useToast();

  const authenticated = Boolean(config?.passkeyAuth.authenticated);
  const ws = useWebSocket(authenticated ? "/api/ws" : undefined);

  const navigate = useCallback((nextRoute: AppRoute) => {
    setRoute(nextRoute);
    window.history.pushState(null, "", routePath(nextRoute));
  }, []);

  const refreshNotifications = useCallback(async (options?: { append?: boolean; offset?: number }) => {
    const params = new URLSearchParams();
    params.set("limit", String(LIST_NOTIFICATIONS_DEFAULT_LIMIT));
    params.set("offset", String(options?.offset ?? 0));
    if (selectedSourceId) {
      params.set("sourceId", selectedSourceId);
    }
    const response = await json<ListNotificationsResponse>(`/api/notifications?${params.toString()}`);
    setNotifications((current) => options?.append ? [...current, ...response.notifications] : response.notifications);
    setUnreadCount(response.unreadCount);
    setPagination(response.pagination);
    setHiddenNewCount(0);
    await updateAppBadge(response.unreadCount);
  }, [selectedSourceId]);

  const refreshHome = useCallback(async () => {
    await Promise.all([refreshSources(), refreshNotifications()]);
  }, [refreshNotifications, refreshSources]);

  const queueHomeRefresh = useCallback(() => {
    if (homeRefreshTimer.current) {
      return;
    }
    homeRefreshTimer.current = setTimeout(() => {
      homeRefreshTimer.current = undefined;
      void refreshHome().catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
    }, 0);
  }, [refreshHome, toast]);

  useEffect(() => {
    const parsed = parseAppRoute(window.location.pathname);
    if (parsed.error) {
      toast.error(parsed.error);
      window.history.replaceState(null, "", "/");
    }
  }, [toast]);

  useEffect(() => {
    const onPopState = (): void => {
      const parsed = parseAppRoute(window.location.pathname);
      setRoute(parsed.route);
      if (parsed.error) {
        toast.error(parsed.error);
        window.history.replaceState(null, "", "/");
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [toast]);

  useEffect(() => {
    if (authenticated) {
      void refreshHome().catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
    } else {
      void clearAppBadge();
    }
  }, [authenticated, refreshHome, toast]);

  useEffect(() => {
    if (!authenticated) {
      return;
    }
    void refreshNotifications().catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
  }, [authenticated, refreshNotifications, toast]);

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
      const matchesSource = !selectedSourceId || event.notification.sourceId === selectedSourceId;
      if (matchesSource) {
        setNotifications((items) => [event.notification, ...items]);
      } else {
        setHiddenNewCount((count) => count + 1);
      }
      setUnreadCount(event.unreadCount);
      void updateAppBadge(event.unreadCount);
    } else if (event.type === "notification.opened") {
      setNotifications((items) => items.map((item) => item.id === event.notification.id ? event.notification : item));
      setUnreadCount(event.unreadCount);
      void updateAppBadge(event.unreadCount);
    } else if (event.type === "notification.deleted") {
      setNotifications((items) => items.filter((item) => item.id !== event.notificationId));
      setUnreadCount(event.unreadCount);
      void updateAppBadge(event.unreadCount);
    } else if (event.type === "notifications.deleted") {
      setNotifications((items) => event.sourceId ? items.filter((item) => item.sourceId !== event.sourceId) : []);
      setUnreadCount(event.unreadCount);
      void updateAppBadge(event.unreadCount);
    } else if (event.type === "notifications.opened") {
      queueHomeRefresh();
      setUnreadCount(event.unreadCount);
      void updateAppBadge(event.unreadCount);
    } else if (event.type.startsWith("source.")) {
      if (event.type === "source.deleted" && selectedSourceId === event.sourceId) {
        setSelectedSourceId("");
      }
      void refreshSources();
    }
  }, [queueHomeRefresh, refreshSources, selectedSourceId, ws.lastEvent]);

  function requestConfirm(confirm: ConfirmState): void {
    setConfirmState(confirm);
  }

  async function runConfirm(action?: () => Promise<void>): Promise<void> {
    const confirmAction = action ?? confirmState?.action;
    if (!confirmAction) {
      return;
    }
    setConfirming(true);
    try {
      await confirmAction();
      setConfirmState(undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setConfirming(false);
    }
  }

  function selectSource(sourceId: string): void {
    setSelectedSourceId(sourceId);
    setRoute({ name: "inbox" });
    window.history.pushState(null, "", "/");
  }

  function openNotification(id: string): void {
    navigate({ name: "notification", id });
  }

  function deleteNotification(id: string): void {
    requestConfirm({
      title: "Delete notification?",
      confirmLabel: "Delete notification",
      danger: true,
      action: async () => {
        await json(`/api/notifications/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast.success("Notification deleted.");
        if (route.name === "notification") {
          navigate({ name: "inbox" });
        }
        await refreshNotifications();
      },
    });
  }

  async function deleteNotificationSet(opened?: boolean): Promise<void> {
    const params = new URLSearchParams();
    if (selectedSourceId) {
      params.set("sourceId", selectedSourceId);
    }
    if (opened !== undefined) {
      params.set("opened", String(opened));
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    await json(`/api/notifications${suffix}`, { method: "DELETE" });
    toast.success("Notifications deleted.");
    await refreshNotifications();
  }

  function deleteAllNotifications(visible: NotificationListItem[]): void {
    const hasUnread = visible.some((notification) => !notification.openedAt);
    if (!hasUnread) {
      requestConfirm({
        title: "Delete all notifications?",
        confirmLabel: "Delete all",
        danger: true,
        action: async () => deleteNotificationSet(),
      });
      return;
    }
    requestConfirm({
      title: "Delete notifications?",
      cancelLabel: "Cancelar",
      actions: [
        { label: "No leidas", action: async () => deleteNotificationSet(false) },
        { label: "Todas", danger: true, action: async () => deleteNotificationSet() },
      ],
    });
  }

  async function loadMore(): Promise<void> {
    if (pagination?.nextOffset === undefined) {
      return;
    }
    setLoadingMore(true);
    try {
      await refreshNotifications({ append: true, offset: pagination.nextOffset });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingMore(false);
    }
  }

  if (!config) {
    return <main className="auth-layout"><Panel className="auth-card">Loading Listen...</Panel><VersionLegend /></main>;
  }
  if (!authenticated) {
    return <AuthGate config={config} onAuthenticated={refreshConfig} />;
  }

  return (
    <>
      <AppShell
        route={route}
        sources={sources}
        selectedSourceId={selectedSourceId}
        onNavigate={navigate}
        onSourceFilter={selectSource}
      >
        {route.name === "inbox" ? (
          <InboxView
            notifications={notifications}
            sources={sources}
            selectedSourceId={selectedSourceId}
            hiddenNewCount={hiddenNewCount}
            pagination={pagination}
            loadingMore={loadingMore}
            onOpen={openNotification}
            onRefresh={() => void refreshHome()}
            onLoadMore={() => void loadMore()}
            onDeleteAll={deleteAllNotifications}
          />
        ) : null}
        {route.name === "notification" ? (
          <NotificationDetailView
            id={route.id}
            onBack={() => navigate({ name: "inbox" })}
            onDelete={deleteNotification}
          />
        ) : null}
        {route.name === "sources" ? <SourcesView sources={sources} refreshSources={refreshSources} requestConfirm={requestConfirm} /> : null}
        {route.name === "settings" ? (
          <SettingsView
            config={config}
            refreshConfig={refreshConfig}
            themePreference={themePreference}
            setThemePreference={setThemePreference}
            requestConfirm={requestConfirm}
          />
        ) : null}
      </AppShell>
      <ConfirmModal
        open={Boolean(confirmState)}
        title={confirmState?.title ?? ""}
        description={confirmState?.description}
        confirmLabel={confirmState?.confirmLabel ?? "Confirm"}
        danger={confirmState?.danger}
        cancelLabel={confirmState?.cancelLabel}
        actions={confirmState?.actions?.map((action) => ({
          label: action.label,
          danger: action.danger,
          onClick: () => void runConfirm(action.action),
        }))}
        confirming={confirming}
        onConfirm={() => void runConfirm()}
        onClose={() => !confirming && setConfirmState(undefined)}
      />
    </>
  );
}

function App(): React.ReactElement {
  return <AppContent />;
}

createRoot(document.getElementById("root")!).render(<App />);
