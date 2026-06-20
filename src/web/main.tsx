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
import { filterNotifications, groupNotifications, type InboxFilter } from "./notificationList";
import { normalizeMarkdownForDisplay } from "./markdown";
import { type AppRoute, parseAppRoute, routePath } from "./routes";
import { applyThemePreference, readStoredThemePreference, THEME_STORAGE_KEY, type ThemePreference } from "./theme";
import { ActionMenu } from "./ui/ActionMenu";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { ConfirmModal } from "./ui/ConfirmModal";
import { EmptyState } from "./ui/EmptyState";
import { Field } from "./ui/Field";
import { IconButton } from "./ui/IconButton";
import { Panel } from "./ui/Panel";
import { ToastProvider, useToast } from "./ui/Toast";
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
  description: string;
  confirmLabel: string;
  danger?: boolean;
  action: () => Promise<void>;
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

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function relativeTimestamp(value: string): string {
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
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
    setSources((await json<{ sources: SourceResponse[] }>("/api/sources?includeDisabled=true")).sources);
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

function AppShell({
  route,
  sources,
  unreadCount,
  selectedSourceId,
  wsStatus,
  onNavigate,
  onSourceFilter,
  children,
}: {
  route: AppRoute;
  sources: SourceResponse[];
  unreadCount: number;
  selectedSourceId: string;
  wsStatus: string;
  onNavigate: (route: AppRoute) => void;
  onSourceFilter: (sourceId: string) => void;
  children: React.ReactNode;
}): React.ReactElement {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    drawerRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const closeAndNavigate = (nextRoute: AppRoute): void => {
    onNavigate(nextRoute);
    setDrawerOpen(false);
  };

  const nav = (
    <nav className="shell-nav" aria-label="Main navigation">
      <Button type="button" variant={route.name === "inbox" ? "primary" : "ghost"} onClick={() => closeAndNavigate({ name: "inbox" })}>Inbox</Button>
      <Button type="button" variant={route.name === "sources" ? "primary" : "ghost"} onClick={() => closeAndNavigate({ name: "sources" })}>Sources</Button>
      <Button type="button" variant={route.name === "settings" ? "primary" : "ghost"} onClick={() => closeAndNavigate({ name: "settings" })}>Settings</Button>
    </nav>
  );

  const sourceList = (
    <div className="source-filter-list">
      <div className="source-filter-heading">Sources</div>
      <button type="button" className={!selectedSourceId ? "source-filter active" : "source-filter"} onClick={() => { onSourceFilter(""); setDrawerOpen(false); }}>
        <span>All sources</span>
      </button>
      {sources.map((source) => (
        <button
          type="button"
          className={selectedSourceId === source.id ? "source-filter active" : "source-filter"}
          key={source.id}
          onClick={() => {
            onSourceFilter(source.id);
            setDrawerOpen(false);
          }}
        >
          <span>{source.name}</span>
          {source.disabledAt ? <Badge variant="disabled">Disabled</Badge> : null}
        </button>
      ))}
    </div>
  );

  return (
    <main className="app-shell">
      <aside className="shell-rail">
        <button type="button" className="brand-button" onClick={() => onNavigate({ name: "inbox" })}>Listen</button>
        <div className="rail-status">
          <Badge variant={wsStatus === "open" ? "success" : wsStatus === "connecting" ? "warning" : "danger"}>
            {wsStatus === "open" ? "Connected" : wsStatus === "connecting" ? "Reconnecting" : "Offline"}
          </Badge>
          <Badge variant={unreadCount > 0 ? "unread" : "read"}>{unreadCount} unread</Badge>
        </div>
        {nav}
        {sourceList}
        <VersionLegend />
      </aside>
      <div className="mobile-topbar">
        <button type="button" className="brand-button" onClick={() => onNavigate({ name: "inbox" })}>Listen</button>
        <Badge variant={unreadCount > 0 ? "unread" : "read"}>{unreadCount}</Badge>
        <IconButton ref={menuButtonRef} type="button" aria-label="Open navigation menu" onClick={() => setDrawerOpen(true)}>☰</IconButton>
      </div>
      {drawerOpen ? (
        <div className="drawer-backdrop" onMouseDown={() => { setDrawerOpen(false); menuButtonRef.current?.focus(); }}>
          <div className="mobile-drawer" ref={drawerRef} onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <strong>Listen</strong>
              <IconButton type="button" aria-label="Close navigation menu" onClick={() => { setDrawerOpen(false); menuButtonRef.current?.focus(); }}>×</IconButton>
            </div>
            {nav}
            {sourceList}
          </div>
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
  inboxFilter,
  search,
  hiddenNewCount,
  pagination,
  loadingMore,
  onSourceChange,
  onFilterChange,
  onSearchChange,
  onOpen,
  onCopyLink,
  onDelete,
  onToggleRead,
  onDeleteVisible,
  onMarkVisibleRead,
  onRefresh,
  onLoadMore,
}: {
  notifications: NotificationListItem[];
  sources: SourceResponse[];
  selectedSourceId: string;
  inboxFilter: InboxFilter;
  search: string;
  hiddenNewCount: number;
  pagination?: ListNotificationsResponse["pagination"];
  loadingMore: boolean;
  onSourceChange: (sourceId: string) => void;
  onFilterChange: (filter: InboxFilter) => void;
  onSearchChange: (query: string) => void;
  onOpen: (id: string) => void;
  onCopyLink: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleRead: (notification: NotificationListItem) => void;
  onDeleteVisible: (visible: NotificationListItem[]) => void;
  onMarkVisibleRead: (visible: NotificationListItem[]) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
}): React.ReactElement {
  const visible = useMemo(() => filterNotifications(notifications, { filter: inboxFilter, sourceId: selectedSourceId, search }), [inboxFilter, notifications, search, selectedSourceId]);
  const groups = useMemo(() => groupNotifications(visible), [visible]);
  const selectedSource = sources.find((source) => source.id === selectedSourceId);

  let emptyState = <EmptyState title="No notifications" description="Create a source and send webhooks to populate the inbox." />;
  if (notifications.length > 0 && inboxFilter === "unread" && visible.length === 0) {
    emptyState = <EmptyState title="You're caught up." description="There are no unread notifications in the current view." />;
  } else if (selectedSource && visible.length === 0) {
    emptyState = <EmptyState title="No source results" description={`${selectedSource.name} has no matching notifications.`} />;
  } else if (search && visible.length === 0) {
    emptyState = <EmptyState title="No search results" description={`No loaded notifications match "${search}".`} action={<Button type="button" variant="ghost" onClick={() => onSearchChange("")}>Clear search</Button>} />;
  }

  return (
    <div className="view-stack">
      <div className="view-header">
        <div>
          <h1>Inbox</h1>
          <p>What arrived, from whom, when, and what still needs attention.</p>
        </div>
        <div className="view-actions">
          <ActionMenu label="Inbox actions">
            <Button type="button" variant="ghost" onClick={onRefresh}>Refresh</Button>
            <Button type="button" variant="secondary" onClick={() => onMarkVisibleRead(visible)} disabled={!visible.some((notification) => !notification.openedAt)}>Mark visible read</Button>
            <Button type="button" variant="danger" onClick={() => onDeleteVisible(visible)} disabled={visible.length === 0}>Delete visible</Button>
          </ActionMenu>
        </div>
      </div>

      <Panel variant="compact" className="inbox-controls">
        <div className="segmented-control" role="group" aria-label="Inbox filter">
          {(["all", "unread", "read"] as const).map((filter) => (
            <button type="button" className={inboxFilter === filter ? "active" : ""} key={filter} onClick={() => onFilterChange(filter)}>{filter}</button>
          ))}
        </div>
        <Field label="Search loaded notifications" htmlFor="notification-search">
          <input id="notification-search" className="app-input" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Title, description, or source" />
        </Field>
        <Field label="Source" htmlFor="source-filter">
          <select id="source-filter" className="app-input" value={selectedSourceId} onChange={(event) => onSourceChange(event.target.value)}>
            <option value="">All sources</option>
            {sources.map((source) => <option key={source.id} value={source.id}>{source.name}{source.disabledAt ? " (disabled)" : ""}</option>)}
          </select>
        </Field>
      </Panel>

      {hiddenNewCount > 0 ? (
        <div className="notice">{hiddenNewCount} new notification{hiddenNewCount === 1 ? "" : "s"} hidden by the current filters. <button type="button" onClick={onRefresh}>Refresh view</button></div>
      ) : null}

      <Panel>
        {groups.length > 0 ? groups.map((group) => (
          <div className="notification-group" key={group.name}>
            <h2>{group.name}</h2>
            <div className="notification-list">
              {group.notifications.map((notification) => (
                <article className={`notification-row ${notification.openedAt ? "read" : "unread"}${notification.icon ? "" : " no-icon"}`} key={notification.id}>
                  {notification.icon ? <img src={notification.icon} alt="" /> : <div className="notification-avatar" aria-hidden="true">{notification.source.slice(0, 1).toUpperCase()}</div>}
                  <button type="button" className="notification-open" aria-label={`Open notification ${notification.title}`} onClick={() => onOpen(notification.id)}>
                    <span className="notification-title-line">
                      <strong>{notification.title}</strong>
                      {!notification.openedAt ? <span className="unread-dot" aria-label="Unread" /> : null}
                    </span>
                    <span>{notification.shortDescription}</span>
                    <small><Badge variant="info">{notification.source}</Badge><span title={formatTimestamp(notification.createdAt)}>{relativeTimestamp(notification.createdAt)}</span></small>
                  </button>
                  <ActionMenu label={`Actions for ${notification.title}`}>
                    <Button type="button" size="sm" variant="ghost" onClick={() => onCopyLink(notification.id)}>Copy link</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => onToggleRead(notification)}>{notification.openedAt ? "Mark unread" : "Mark read"}</Button>
                    <Button type="button" size="sm" variant="danger" onClick={() => onDelete(notification.id)}>Delete</Button>
                  </ActionMenu>
                </article>
              ))}
            </div>
          </div>
        )) : emptyState}
        {pagination?.nextOffset !== undefined ? (
          <div className="load-more-row">
            <Button type="button" onClick={onLoadMore} loading={loadingMore}>Load more</Button>
            <span className="muted">Showing {notifications.length} of {pagination.total}</span>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function NotificationDetailView({
  id,
  notifications,
  onBack,
  onCopyLink,
  onDelete,
  onToggleRead,
  onFilterSource,
  onNavigate,
}: {
  id: string;
  notifications: NotificationListItem[];
  onBack: () => void;
  onCopyLink: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleRead: (notification: NotificationListItem) => void;
  onFilterSource: (sourceId: string) => void;
  onNavigate: (id: string) => void;
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

  const currentIndex = notifications.findIndex((notification) => notification.id === id);
  const currentListItem = notifications.find((notification) => notification.id === id);
  const currentOpenedAt = currentListItem ? currentListItem.openedAt : detail?.openedAt;
  const previous = currentIndex > 0 ? notifications[currentIndex - 1] : undefined;
  const next = currentIndex >= 0 ? notifications[currentIndex + 1] : undefined;

  if (error) {
    return (
      <Panel title="Notification not found" description="This notification could not be loaded." className="detail-panel">
        <p className="error">{error}</p>
        <Button type="button" onClick={onBack}>Back to inbox</Button>
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
          <Button type="button" variant="ghost" onClick={onBack}>Back to inbox</Button>
          <h1>{detail.title}</h1>
          <p>{detail.shortDescription}</p>
        </div>
        <div className="view-actions">
          <Badge variant="info">{detail.source}</Badge>
          <Badge variant={currentOpenedAt ? "read" : "unread"}>{currentOpenedAt ? "Read" : "Unread"}</Badge>
          <span className="muted" title={formatTimestamp(detail.createdAt)}>{relativeTimestamp(detail.createdAt)}</span>
        </div>
      </div>

      <Panel className="detail-panel">
        <div className="detail-actions-top">
          <ActionMenu label="Notification actions">
            <Button type="button" variant="ghost" onClick={() => onCopyLink(detail.id)}>Copy link</Button>
            {detail.sourceId ? <Button type="button" variant="ghost" onClick={() => onFilterSource(detail.sourceId ?? "")}>Filter by source</Button> : null}
            <Button
              type="button"
              variant="ghost"
              onClick={() => onToggleRead({
                id: detail.id,
                title: detail.title,
                shortDescription: detail.shortDescription,
                source: detail.source,
                sourceId: detail.sourceId,
                icon: detail.icon,
                createdAt: detail.createdAt,
                openedAt: currentOpenedAt,
              })}
            >
              {currentOpenedAt ? "Mark unread" : "Mark read"}
            </Button>
            <Button type="button" variant="danger" onClick={() => onDelete(detail.id)}>Delete</Button>
          </ActionMenu>
        </div>
        <div className="detail-summary">
          {detail.icon ? <img className="detail-icon" src={detail.icon} alt="" /> : <div className="detail-icon fallback" aria-hidden="true">{detail.source.slice(0, 1).toUpperCase()}</div>}
          <div>
            <h2>{detail.title}</h2>
            <p>{detail.shortDescription}</p>
            <small>{detail.source} • {formatTimestamp(detail.createdAt)}</small>
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
        <div className="detail-navigation">
          <Button type="button" variant="secondary" disabled={!previous} onClick={() => previous && onNavigate(previous.id)}>Previous</Button>
          <Button type="button" variant="secondary" disabled={!next} onClick={() => next && onNavigate(next.id)}>Next</Button>
        </div>
      </Panel>
    </div>
  );
}

function SourcesView({ sources, refreshSources, requestConfirm }: { sources: SourceResponse[]; refreshSources: () => Promise<void>; requestConfirm: (confirm: ConfirmState) => void }): React.ReactElement {
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState<string>();
  const [copiedWebhook, setCopiedWebhook] = useState(false);
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
      setWebhookUrl(response.webhookUrl);
      setCopiedWebhook(false);
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
        setWebhookUrl(response.webhookUrl);
        setCopiedWebhook(false);
        toast.success("Source token rotated.");
        await refreshSources();
      },
    });
  }

  function disable(source: SourceResponse): void {
    requestConfirm({
      title: "Disable source?",
      description: `Future webhooks for ${source.name} will be rejected. Existing notifications remain in the inbox.`,
      confirmLabel: "Disable source",
      danger: true,
      action: async () => {
        await json(`/api/sources/${encodeURIComponent(source.id)}`, { method: "DELETE" });
        toast.success("Source disabled.");
        await refreshSources();
      },
    });
  }

  async function copyWebhook(): Promise<void> {
    if (!webhookUrl) {
      return;
    }
    await navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    toast.success("Webhook URL copied.");
  }

  return (
    <div className="view-stack">
      <div className="view-header">
        <div>
          <h1>Sources</h1>
          <p>Manage sender identities, webhook status, and safe token rotation.</p>
        </div>
      </div>
      <Panel title="Create source" description="Create a sender identity and copy the generated webhook URL immediately.">
        {webhookUrl ? (
          <div className="secret-box">
            <strong>Copy this webhook URL now. Listen will not show the token again.</strong>
            <code>{webhookUrl}</code>
            <div className="row">
              <ActionMenu label="Webhook URL actions" align="left">
                <Button type="button" variant="primary" onClick={() => void copyWebhook()}>Copy URL</Button>
                <Button type="button" variant="ghost" onClick={() => setWebhookUrl(undefined)} disabled={!copiedWebhook}>Dismiss after copied</Button>
              </ActionMenu>
            </div>
          </div>
        ) : null}
        <div className="source-create-grid">
          <Field label="Source name" htmlFor="source-name" required helpText={`Maximum ${NOTIFICATION_SOURCE_NAME_MAX_CHARS} characters.`} errorText={error ?? nameError}>
            <input id="source-name" className="app-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="CI Pipeline" maxLength={NOTIFICATION_SOURCE_NAME_MAX_CHARS + 1} />
          </Field>
          <Button type="button" variant="primary" loading={busy} onClick={() => void create()}>Create source</Button>
        </div>
      </Panel>

      <Panel title="Integration examples" description="Use the one-time URL with agents, scripts, or raw webhooks.">
        <div className="code-grid">
          <code>listen config set-webhook-url "&lt;url&gt;"</code>
          <code>listen notify --title "Done" --description "Agent finished" --markdown "..."</code>
          <code>{`curl -X POST "<url>" -H "content-type: application/json" -d '{"title":"Done","shortDescription":"Agent finished","markdownContent":"..."}'`}</code>
        </div>
        <p className="muted">Listen stores only a token hash. Webhook payloads cannot override the source identity from the URL.</p>
      </Panel>

      <Panel title="Configured sources">
        <div className="source-table">
          {sources.map((source) => (
            <article className="source-card" key={source.id}>
              <div>
                <h3>{source.name}</h3>
                <div className="badge-row">
                  <Badge variant={source.disabledAt ? "disabled" : "active"}>{source.disabledAt ? "Disabled" : "Active"}</Badge>
                  {!source.lastUsedAt ? <Badge variant="warning">Never used</Badge> : null}
                </div>
                <small>Created {formatTimestamp(source.createdAt)} • Last used {source.lastUsedAt ? formatTimestamp(source.lastUsedAt) : "Never used"}</small>
              </div>
              <div className="row-actions">
                <ActionMenu label={`Actions for ${source.name}`}>
                  <Button type="button" size="sm" variant="secondary" onClick={() => rotate(source)}>Rotate token</Button>
                  <Button type="button" size="sm" variant="danger" disabled={Boolean(source.disabledAt)} onClick={() => disable(source)}>Disable</Button>
                </ActionMenu>
              </div>
            </article>
          ))}
          {sources.length === 0 ? <EmptyState title="No sources" description="Create a source to get a one-time webhook URL." /> : null}
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
        <p>{preference?.isFromEnv ? "Controlled by LISTEN_LOG_LEVEL." : "Change server log verbosity at runtime."}</p>
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
          <p>Manage passkey session, browser push, display, diagnostics, and server operation.</p>
        </div>
      </div>

      <Panel>
        <section className="settings-card">
          <div>
            <div className="settings-card-title-row">
              <h3>Security</h3>
              {config.passkeyAuth.passkeyDisabled ? <Badge variant="warning">Passkeys disabled</Badge> : <Badge variant="success">Passkey protected</Badge>}
            </div>
            <p>{config.passkeyAuth.passkeyDisabled ? "Recovery mode is enabled by LISTEN_DISABLE_PASSKEY. Remove it to restore passkey enforcement." : "Protected APIs use the current passkey session."}</p>
          </div>
          <div className="settings-card-actions">
            <ActionMenu label="Security actions">
              <Button type="button" onClick={() => void json("/api/passkey-auth/logout", { method: "POST" }).then(refreshConfig)}>Logout</Button>
              <Button type="button" variant="danger" onClick={deletePasskey}>Delete passkey</Button>
            </ActionMenu>
          </div>
        </section>

        <BrowserPushSettings onEnabled={() => toast.success("Browser push enabled.")} onDisabled={() => toast.success("Browser push disabled.")} />

        <section className="settings-card">
          <div>
            <h3>Display</h3>
            <p>Theme preference is stored locally in this browser.</p>
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
            <p>Terminate the server process. In containerized environments, this usually restarts the container.</p>
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
  const [unreadCount, setUnreadCount] = useState(0);
  const [pagination, setPagination] = useState<ListNotificationsResponse["pagination"]>();
  const [route, setRoute] = useState<AppRoute>(() => parseAppRoute(window.location.pathname).route);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>("all");
  const [search, setSearch] = useState("");
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
    if (inboxFilter === "read") {
      params.set("opened", "true");
    } else if (inboxFilter === "unread") {
      params.set("opened", "false");
    }
    const response = await json<ListNotificationsResponse>(`/api/notifications?${params.toString()}`);
    setNotifications((current) => options?.append ? [...current, ...response.notifications] : response.notifications);
    setUnreadCount(response.unreadCount);
    setPagination(response.pagination);
    setHiddenNewCount(0);
    await updateAppBadge(response.unreadCount);
  }, [inboxFilter, selectedSourceId]);

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
  }, [inboxFilter, refreshNotifications, search, selectedSourceId, toast, authenticated]);

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
      const matchesServerFilters = (!selectedSourceId || event.notification.sourceId === selectedSourceId)
        && (inboxFilter === "all" || (inboxFilter === "unread" && !event.notification.openedAt) || (inboxFilter === "read" && event.notification.openedAt));
      const matchesSearch = filterNotifications([event.notification], { filter: inboxFilter, sourceId: selectedSourceId, search }).length > 0;
      if (matchesServerFilters && matchesSearch) {
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
      void refreshSources();
    }
  }, [inboxFilter, queueHomeRefresh, refreshSources, search, selectedSourceId, ws.lastEvent]);

  function requestConfirm(confirm: ConfirmState): void {
    setConfirmState(confirm);
  }

  async function runConfirm(): Promise<void> {
    if (!confirmState) {
      return;
    }
    setConfirming(true);
    try {
      await confirmState.action();
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

  function copyNotificationLink(id: string): void {
    void navigator.clipboard.writeText(`${window.location.origin}${routePath({ name: "notification", id })}`)
      .then(() => toast.success("Notification link copied."))
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
  }

  function deleteNotification(id: string): void {
    requestConfirm({
      title: "Delete notification?",
      description: "This permanently removes the notification from Listen.",
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

  function toggleRead(notification: NotificationListItem): void {
    const markUnread = Boolean(notification.openedAt);
    requestConfirm({
      title: markUnread ? "Mark notification unread?" : "Mark notification read?",
      description: markUnread ? "This returns the notification to the unread queue." : "This clears the notification from the unread queue.",
      confirmLabel: markUnread ? "Mark unread" : "Mark read",
      action: async () => {
        const response = await json<{ notification: NotificationListItem }>(`/api/notifications/${encodeURIComponent(notification.id)}/${markUnread ? "unread" : "read"}`, { method: "POST" });
        setNotifications((items) => items.map((item) => item.id === response.notification.id ? response.notification : item));
        toast.success(markUnread ? "Notification marked unread." : "Notification marked read.");
        await refreshNotifications();
      },
    });
  }

  function deleteVisible(visible: NotificationListItem[]): void {
    requestConfirm({
      title: "Delete visible notifications?",
      description: `This permanently removes ${visible.length} loaded notification${visible.length === 1 ? "" : "s"} currently visible with your filters.`,
      confirmLabel: "Delete visible",
      danger: true,
      action: async () => {
        await Promise.all(visible.map((notification) => json(`/api/notifications/${encodeURIComponent(notification.id)}`, { method: "DELETE" })));
        toast.success("Visible notifications deleted.");
        await refreshNotifications();
      },
    });
  }

  function markVisibleRead(visible: NotificationListItem[]): void {
    const unreadVisible = visible.filter((notification) => !notification.openedAt);
    requestConfirm({
      title: "Mark visible read?",
      description: `This marks ${unreadVisible.length} visible unread notification${unreadVisible.length === 1 ? "" : "s"} as read.`,
      confirmLabel: "Mark visible read",
      action: async () => {
        await Promise.all(unreadVisible.map((notification) => json(`/api/notifications/${encodeURIComponent(notification.id)}/read`, { method: "POST" })));
        toast.success("Visible notifications marked read.");
        await refreshNotifications();
      },
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
        unreadCount={unreadCount}
        selectedSourceId={selectedSourceId}
        wsStatus={ws.status}
        onNavigate={navigate}
        onSourceFilter={selectSource}
      >
        {route.name === "inbox" ? (
          <InboxView
            notifications={notifications}
            sources={sources}
            selectedSourceId={selectedSourceId}
            inboxFilter={inboxFilter}
            search={search}
            hiddenNewCount={hiddenNewCount}
            pagination={pagination}
            loadingMore={loadingMore}
            onSourceChange={setSelectedSourceId}
            onFilterChange={setInboxFilter}
            onSearchChange={setSearch}
            onOpen={openNotification}
            onCopyLink={copyNotificationLink}
            onDelete={deleteNotification}
            onToggleRead={toggleRead}
            onDeleteVisible={deleteVisible}
            onMarkVisibleRead={markVisibleRead}
            onRefresh={() => void refreshHome()}
            onLoadMore={() => void loadMore()}
          />
        ) : null}
        {route.name === "notification" ? (
          <NotificationDetailView
            id={route.id}
            notifications={notifications}
            onBack={() => navigate({ name: "inbox" })}
            onCopyLink={copyNotificationLink}
            onDelete={deleteNotification}
            onToggleRead={toggleRead}
            onFilterSource={selectSource}
            onNavigate={(id) => navigate({ name: "notification", id })}
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
        description={confirmState?.description ?? ""}
        confirmLabel={confirmState?.confirmLabel ?? "Confirm"}
        danger={confirmState?.danger}
        confirming={confirming}
        onConfirm={() => void runConfirm()}
        onClose={() => !confirming && setConfirmState(undefined)}
      />
    </>
  );
}

function App(): React.ReactElement {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
