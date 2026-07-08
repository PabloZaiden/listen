import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { NotificationDetail, NotificationListItem, SourceResponse } from "@listen/contracts";
import { NOTIFICATION_SOURCE_NAME_MAX_CHARS } from "@listen/shared";
import {
  Button,
  ActionMenu,
  ConfirmDialog,
  DataList,
  DataListRow,
  EmptyState,
  FormActions,
  Page,
  Panel,
  TextField,
  WebAppRoot,
  renderWebApp,
  useRealtimeRefresh,
  appFetch,
  WebAppApiError,
  type ActionMenuItem,
  type SidebarNode,
  type WebAppRoute,
} from "@pablozaiden/webapp/web";
import "@pablozaiden/webapp/web/styles.css";
import { LISTEN_VERSION } from "../version";
import "./app-badge";
import { BrowserPushSettings } from "./browserPushSettings";
import { SWIPE_ACTION_WIDTH, clampSwipeOffset, detectSwipeIntent, shouldCancelSwipeClick, shouldRevealSwipeActions, type SwipeIntent } from "./swipe-actions";
import "./styles.css";

type ConfirmState = {
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  action: () => Promise<void>;
};

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

interface WebAppConfigResponse {
  passkeyAuth: {
    enabled: boolean;
    bootstrapRequired: boolean;
    ownerPasskeySetupRequired: boolean;
    passkeyRequired: boolean;
    authenticated: boolean;
  };
}

function needsAuthentication(config: WebAppConfigResponse): boolean {
  return config.passkeyAuth.enabled
    && (
      config.passkeyAuth.bootstrapRequired
      || config.passkeyAuth.ownerPasskeySetupRequired
      || (config.passkeyAuth.passkeyRequired && !config.passkeyAuth.authenticated)
    );
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await appFetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
  return await response.json() as T;
}

type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

type AppBadgeGlobal = typeof globalThis & {
  listenUpdateAppBadge: (badgeNavigator: BadgeNavigator, unreadCount: number, warningSource: string) => Promise<void>;
};

function syncAppBadgeFromUnreadCount(unreadCount: number): void {
  void (globalThis as AppBadgeGlobal).listenUpdateAppBadge(navigator as BadgeNavigator, unreadCount, "notifications refresh");
}

function isAuthRequiredError(error: unknown): boolean {
  return error instanceof WebAppApiError && error.status === 401 && error.error === "authentication_required";
}

function routeToHash(route: WebAppRoute): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(route)) {
    if (key !== "view" && value !== undefined) params.set(key, String(value));
  }
  return `#/${route.view}${params.size ? `?${params.toString()}` : ""}`;
}

function navigateTo(route: WebAppRoute): void {
  window.location.hash = routeToHash(route);
}

function notificationRoute(id: string, sourceId?: string): WebAppRoute {
  return sourceId ? { view: "notification", id, sourceId } : { view: "notification", id };
}

function sourceFilterRoute(sourceId?: string): WebAppRoute {
  return sourceId ? { view: "inbox", sourceId } : { view: "inbox" };
}

function normalizeMarkdownForDisplay(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

function NotificationTimestamp({ value }: { value: string }) {
  const date = new Date(value);
  return (
    <span className="listen-notification-timestamp" aria-label={date.toLocaleString()}>
      <span>{date.toLocaleDateString()}</span>
      <span>{date.toLocaleTimeString()}</span>
    </span>
  );
}

type NotificationListRowProps = {
  notification: NotificationListItem;
  sourceId?: string;
  isOpen: boolean;
  setOpenRowId: (id: string | undefined) => void;
  markNotificationOpened: (notification: NotificationListItem) => Promise<void>;
  requestDeleteNotification: (notification: NotificationListItem) => void;
};

type SwipeStart = {
  x: number;
  y: number;
  offset: number;
  intent: SwipeIntent;
};

function NotificationListRow({
  notification,
  sourceId,
  isOpen,
  setOpenRowId,
  markNotificationOpened,
  requestDeleteNotification,
}: NotificationListRowProps) {
  const swipeStart = useRef<SwipeStart | undefined>(undefined);
  const suppressClick = useRef(false);
  const [dragOffset, setDragOffset] = useState<number>();
  const isUnread = !notification.openedAt;
  const markLabel = isUnread ? "Mark as read" : "Mark as unread";
  const currentOffset = dragOffset ?? (isOpen ? -SWIPE_ACTION_WIDTH : 0);

  function closeActions(): void {
    setDragOffset(undefined);
    setOpenRowId(undefined);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    swipeStart.current = {
      x: event.clientX,
      y: event.clientY,
      offset: isOpen ? -SWIPE_ACTION_WIDTH : 0,
      intent: "pending",
    };
    suppressClick.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const start = swipeStart.current;
    if (!start) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (start.intent === "pending") {
      start.intent = detectSwipeIntent(deltaX, deltaY);
    }
    if (start.intent === "vertical") return;
    if (start.intent !== "horizontal") return;
    if (shouldCancelSwipeClick(deltaX, deltaY)) suppressClick.current = true;
    setDragOffset(clampSwipeOffset(start.offset + deltaX));
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>): void {
    const start = swipeStart.current;
    swipeStart.current = undefined;
    if (!start) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (start.intent !== "horizontal") {
      setDragOffset(undefined);
      return;
    }
    const nextOffset = clampSwipeOffset(start.offset + deltaX);
    if (shouldCancelSwipeClick(deltaX, deltaY)) suppressClick.current = true;
    setDragOffset(undefined);
    setOpenRowId(shouldRevealSwipeActions(nextOffset) ? notification.id : undefined);
  }

  function handleRowClick(): void {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (isOpen) {
      closeActions();
      return;
    }
    navigateTo(notificationRoute(notification.id, sourceId));
  }

  async function runMarkAction(): Promise<void> {
    closeActions();
    await markNotificationOpened(notification);
  }

  function runDeleteAction(): void {
    closeActions();
    requestDeleteNotification(notification);
  }

  const actionItems: ActionMenuItem[] = [
    { id: isUnread ? "mark-read" : "mark-unread", label: markLabel, onAction: () => void runMarkAction() },
    { id: "delete", label: "Delete", destructive: true, onAction: runDeleteAction },
  ];

  return (
    <div className={`listen-swipe-row ${isOpen ? "is-open" : ""}`}>
      <div className="listen-swipe-actions" aria-hidden={!isOpen}>
        <button
          type="button"
          className="listen-swipe-action"
          tabIndex={isOpen ? 0 : -1}
          onClick={() => void runMarkAction()}
        >
          {markLabel}
        </button>
        <button
          type="button"
          className="listen-swipe-action destructive"
          tabIndex={isOpen ? 0 : -1}
          onClick={runDeleteAction}
        >
          Delete
        </button>
      </div>
      <div
        className={`listen-swipe-content ${dragOffset === undefined ? "" : "is-dragging"}`}
        style={{ transform: `translateX(${currentOffset}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <DataListRow
          title={(
            <span className={`listen-notification-title ${notification.openedAt ? "" : "unread"}`}>
              {notification.openedAt ? null : <span className="listen-unread-dot" aria-hidden="true" />}
              <span>{notification.title}</span>
            </span>
          )}
          description={notification.shortDescription}
          meta={isOpen ? undefined : <NotificationTimestamp value={notification.createdAt} />}
          actions={isOpen ? undefined : <ActionMenu ariaLabel={`Actions for ${notification.title}`} items={actionItems} />}
          onClick={handleRowClick}
        />
      </div>
    </div>
  );
}

function useSources(): [SourceResponse[], () => Promise<void>] {
  const [sources, setSources] = useState<SourceResponse[]>([]);
  const [authBlocked, setAuthBlocked] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const config = await api<WebAppConfigResponse>("/api/config");
      if (needsAuthentication(config)) {
        setAuthBlocked(true);
        return;
      }
      const response = await api<{ sources: SourceResponse[] }>("/api/sources");
      setSources(response.sources);
      setAuthBlocked(false);
    } catch (error) {
      if (!isAuthRequiredError(error)) throw error;
      setAuthBlocked(true);
    }
  }, []);
  useEffect(() => void refresh().catch((error) => console.error(error)), [refresh]);
  useEffect(() => {
    if (!authBlocked) return undefined;
    const timer = setInterval(() => void refresh().catch((error) => console.error(error)), 1_000);
    return () => clearInterval(timer);
  }, [authBlocked, refresh]);
  return [sources, refresh];
}

function useNotifications(sourceId?: string): [ListNotificationsResponse | undefined, () => Promise<void>] {
  const [result, setResult] = useState<ListNotificationsResponse>();
  const refresh = useCallback(async () => {
    const params = new URLSearchParams({ limit: "50", offset: "0" });
    if (sourceId) params.set("sourceId", sourceId);
    const response = await api<ListNotificationsResponse>(`/api/notifications?${params}`);
    setResult(response);
    syncAppBadgeFromUnreadCount(response.unreadCount);
  }, [sourceId]);
  useEffect(() => void refresh().catch((error) => console.error("Could not load notifications", error)), [refresh]);
  return [result, refresh];
}

function InboxView({ route, refreshSources, requestConfirm }: { route: WebAppRoute; refreshSources: () => Promise<void>; requestConfirm: (confirm: ConfirmState) => void }) {
  const sourceId = typeof route.sourceId === "string" ? route.sourceId : undefined;
  const [result, refreshNotifications] = useNotifications(sourceId);
  const [openRowId, setOpenRowId] = useState<string>();
  useRealtimeRefresh({
    resources: ["notifications", "sources"],
    refresh: async () => {
      await Promise.all([refreshSources(), refreshNotifications()]);
    },
  });
  const notifications = result?.notifications ?? [];

  async function markNotificationOpened(notification: NotificationListItem): Promise<void> {
    const action = notification.openedAt ? "unread" : "read";
    await api(`/api/notifications/${encodeURIComponent(notification.id)}/${action}`, { method: "POST" });
    setOpenRowId(undefined);
    await refreshNotifications();
  }

  function requestDeleteNotification(notification: NotificationListItem): void {
    requestConfirm({
      title: "Delete notification?",
      description: "This notification will be permanently removed.",
      confirmLabel: "Delete notification",
      danger: true,
      action: async () => {
        await api(`/api/notifications/${encodeURIComponent(notification.id)}`, { method: "DELETE" });
        setOpenRowId(undefined);
        await refreshNotifications();
      },
    });
  }

  return (
    <Page className="listen-stack" onPointerDown={(event) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest(".listen-swipe-row")) setOpenRowId(undefined);
    }}>
      {notifications.length > 0 ? (
        <Panel>
          <DataList>
            {notifications.map((notification) => (
              <NotificationListRow
                key={notification.id}
                notification={notification}
                sourceId={sourceId}
                isOpen={openRowId === notification.id}
                setOpenRowId={setOpenRowId}
                markNotificationOpened={markNotificationOpened}
                requestDeleteNotification={requestDeleteNotification}
              />
            ))}
          </DataList>
        </Panel>
      ) : null}
    </Page>
  );
}

function NotificationView({ route }: { route: WebAppRoute }) {
  const id = typeof route.id === "string" ? route.id : "";
  const returnSourceId = typeof route.sourceId === "string" ? route.sourceId : undefined;
  const returnRoute = sourceFilterRoute(returnSourceId);
  const [detail, setDetail] = useState<NotificationDetail>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!id) return;
    const response = await api<{ notification: NotificationDetail }>(`/api/notifications/${encodeURIComponent(id)}`, { signal });
    if (signal?.aborted) return;
    setDetail(response.notification);
    setError(undefined);
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    setDetail(undefined);
    setError(undefined);
    void refresh(controller.signal).catch((err) => {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
    return () => controller.abort();
  }, [refresh]);

  if (error) {
    return <Page><EmptyState title="Notification not found" description={error} /></Page>;
  }
  if (!detail) {
    return <Page><Panel><EmptyState title="Loading notification..." /></Panel></Page>;
  }

  return (
    <Page className="listen-stack">
      <Panel>
        <div className="listen-detail-summary">
          {detail.icon ? <img className="listen-detail-icon" src={detail.icon} alt="" /> : null}
          <div>
            <h2>{detail.title}</h2>
            <p>{detail.shortDescription}</p>
          </div>
        </div>
        <div className="listen-markdown">
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
            components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer noopener" /> }}
          >
            {normalizeMarkdownForDisplay(detail.markdownContent)}
          </ReactMarkdown>
        </div>
      </Panel>
      <FormActions>
        <Button type="button" onClick={() => navigateTo(returnRoute)}>Back</Button>
      </FormActions>
    </Page>
  );
}

function SourcesView({ sources, refreshSources, requestConfirm }: { sources: SourceResponse[]; refreshSources: () => Promise<void>; requestConfirm: (confirm: ConfirmState) => void }) {
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function copyWebhook(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setError(undefined);
    } catch {
      setError("Could not copy the webhook URL. Copy it manually from the text above.");
    }
  }

  async function create(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a source name.");
      return;
    }
    if (trimmed.length > NOTIFICATION_SOURCE_NAME_MAX_CHARS) {
      setError(`Source names must be ${NOTIFICATION_SOURCE_NAME_MAX_CHARS} characters or fewer.`);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const response = await api<{ source: SourceResponse; webhookUrl: string }>("/api/sources", { method: "POST", body: JSON.stringify({ name: trimmed }) });
      setWebhookUrl(response.webhookUrl);
      setName("");
      await refreshSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function rotate(source: SourceResponse): void {
    requestConfirm({
      title: "Rotate source token?",
      description: `The old webhook URL for ${source.name} will stop working immediately.`,
      confirmLabel: "Rotate token",
      danger: true,
      action: async () => {
        const response = await api<{ webhookUrl: string }>(`/api/sources/${encodeURIComponent(source.id)}/token/rotate`, { method: "POST" });
        setWebhookUrl(response.webhookUrl);
        await refreshSources();
      },
    });
  }

  function deleteSource(source: SourceResponse): void {
    requestConfirm({
      title: "Delete source?",
      description: `This will delete ${source.name} and all notifications from this source.`,
      confirmLabel: "Delete source",
      danger: true,
      action: async () => {
        await api(`/api/sources/${encodeURIComponent(source.id)}`, { method: "DELETE" });
        await refreshSources();
      },
    });
  }

  return (
    <Page className="listen-stack">
      <Panel>
        {webhookUrl ? (
          <div className="listen-secret">
            <div className="listen-secret-copy">
              <div className="listen-secret-text">
                <strong>New webhook URL</strong>
                <code>{webhookUrl}</code>
              </div>
              <Button type="button" onClick={() => void copyWebhook(webhookUrl)}>Copy URL</Button>
            </div>
          </div>
        ) : null}
        <div className="listen-source-create">
          <TextField label="Source name" value={name} onChange={(event) => setName(event.currentTarget.value)} error={error} />
          <Button type="button" variant="primary" disabled={busy} onClick={() => void create()}>{busy ? "Creating..." : "Create source"}</Button>
        </div>
      </Panel>
      {sources.length > 0 ? (
        <Panel>
          <DataList>
            {sources.map((source) => (
              <DataListRow
                key={source.id}
                title={source.name}
                description={source.lastUsedAt ? `Last used ${new Date(source.lastUsedAt).toLocaleString()}` : "Not used yet"}
                badge={source.disabledAt ? "disabled" : undefined}
                actions={(
                  <ActionMenu
                    ariaLabel={`Actions for ${source.name}`}
                    items={[
                      { id: "rotate-token", label: "Rotate token", onAction: () => rotate(source) },
                      { id: "delete", label: "Delete", destructive: true, onAction: () => deleteSource(source) },
                    ]}
                  />
                )}
              />
            ))}
          </DataList>
        </Panel>
      ) : null}
    </Page>
  );
}

function ListenApp(): React.ReactElement {
  const [sources, refreshSources] = useSources();
  const [confirmState, setConfirmState] = useState<ConfirmState>();
  const [confirming, setConfirming] = useState(false);

  const sidebarNodes = useCallback((): SidebarNode[] => [
      { type: "item", id: "inbox", title: "Inbox", route: { view: "inbox" } },
      { type: "item", id: "sources", title: "Sources", route: { view: "sources" } },
  ], []);

  function sourceIdFromRoute(route: WebAppRoute): string | undefined {
    return typeof route.sourceId === "string" ? route.sourceId : undefined;
  }

  function selectedSourceName(sourceId: string | undefined): string | undefined {
    return sources.find((source) => source.id === sourceId)?.name;
  }

  async function markAllAsRead(sourceId: string | undefined): Promise<void> {
    const params = new URLSearchParams();
    if (sourceId) params.set("sourceId", sourceId);
    await api(`/api/notifications/read${params.size ? `?${params}` : ""}`, { method: "POST" });
  }

  function deleteAll(sourceId: string | undefined): void {
    const sourceName = selectedSourceName(sourceId);
    setConfirmState({
      title: sourceName ? `Delete ${sourceName} notifications?` : "Delete all notifications?",
      description: "This cannot be undone.",
      confirmLabel: "Delete all",
      danger: true,
      action: async () => {
        const params = new URLSearchParams();
        if (sourceId) params.set("sourceId", sourceId);
        await api(`/api/notifications${params.size ? `?${params}` : ""}`, { method: "DELETE" });
      },
    });
  }

  async function markNotificationUnread(route: WebAppRoute): Promise<void> {
    const id = typeof route.id === "string" ? route.id : "";
    if (!id) return;
    await api(`/api/notifications/${encodeURIComponent(id)}/unread`, { method: "POST" });
    navigateTo(sourceFilterRoute(sourceIdFromRoute(route)));
  }

  function deleteNotification(route: WebAppRoute): void {
    const id = typeof route.id === "string" ? route.id : "";
    if (!id) return;
    setConfirmState({
      title: "Delete notification?",
      description: "This notification will be permanently removed.",
      confirmLabel: "Delete notification",
      danger: true,
      action: async () => {
        await api(`/api/notifications/${encodeURIComponent(id)}`, { method: "DELETE" });
        navigateTo(sourceFilterRoute(sourceIdFromRoute(route)));
      },
    });
  }

  const headerActions = useCallback((route: WebAppRoute): ActionMenuItem[] => {
    if (route.view === "inbox") {
      const sourceId = sourceIdFromRoute(route);
      return [
        { id: "mark-all-read", label: "Mark all as read", onAction: () => void markAllAsRead(sourceId) },
        { id: "delete-all", label: "Delete all", destructive: true, onAction: () => deleteAll(sourceId) },
      ];
    }
    if (route.view === "notification") {
      return [
        { id: "mark-unread", label: "Mark as unread", onAction: () => void markNotificationUnread(route) },
        { id: "delete", label: "Delete", destructive: true, onAction: () => deleteNotification(route) },
      ];
    }
    return [];
  }, [sources]);

  const routes = useMemo(() => ({
    inbox: (route: WebAppRoute) => <InboxView route={route} refreshSources={refreshSources} requestConfirm={setConfirmState} />,
    notification: (route: WebAppRoute) => <NotificationView route={route} />,
    sources: () => <SourcesView sources={sources} refreshSources={refreshSources} requestConfirm={setConfirmState} />,
  }), [refreshSources, sources]);

  async function runConfirm(): Promise<void> {
    if (!confirmState) return;
    setConfirming(true);
    try {
      await confirmState.action();
      setConfirmState(undefined);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <>
      <WebAppRoot
        appName="Listen"
        homeRoute={{ view: "inbox" }}
        version={LISTEN_VERSION}
        sidebar={{ getNodes: sidebarNodes, search: false }}
        routes={routes}
        header={{
          renderTitle: ({ route }) => {
            if (route.view === "settings") return "Settings";
            if (route.view === "sources") return "Sources";
            if (route.view === "notification") return "Notification";
            const sourceId = typeof route.sourceId === "string" ? route.sourceId : undefined;
            return sources.find((source) => source.id === sourceId)?.name ?? "Inbox";
          },
          getActions: ({ route }) => headerActions(route),
        }}
        settings={{
          sections: [
            {
              id: "browser-push",
              title: "Browser notifications",
              render: () => <BrowserPushSettings />,
            },
          ],
        }}
      />
      {confirmState ? (
        <ConfirmDialog
          open
          title={confirmState.title}
          message={confirmState.description ?? confirmState.title}
          confirmLabel={confirmState.confirmLabel}
          danger={confirmState.danger}
          onCancel={() => setConfirmState(undefined)}
          onConfirm={() => void runConfirm()}
        />
      ) : null}
    </>
  );
}

renderWebApp(<ListenApp />);
