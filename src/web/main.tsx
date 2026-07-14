import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { NotificationDetail, NotificationListItem, SourceMutationResponse, SourceResponse } from "@listen/contracts";
import { LIST_NOTIFICATIONS_DEFAULT_LIMIT, NOTIFICATION_SOURCE_NAME_MAX_CHARS } from "@listen/shared";
import {
  Button,
  ActionMenu,
  ConfirmDialog,
  DataList,
  DataListRow,
  ErrorState,
  EmptyState,
  FormActions,
  LoadingState,
  Page,
  Panel,
  TextField,
  WebAppRoot,
  appJson,
  replaceWebAppRoute,
  renderWebApp,
  useRealtimeRefresh,
  type ActionMenuItem,
  type SidebarNode,
  type WebAppRoute,
} from "@pablozaiden/webapp/web";
import "@pablozaiden/webapp/web/styles.css";
import { LISTEN_VERSION } from "../version";
import "./app-badge";
import { BrowserPushSettings } from "./browserPushSettings";
import {
  createNotificationCollectionState,
  mergeNotificationPage,
  removeNotification,
  replaceNotification,
  resetNotificationCollection,
  type NotificationCollectionState,
  type NotificationListResponse,
} from "./notification-pagination";
import { SWIPE_ACTION_WIDTH, clampSwipeOffset, detectSwipeIntent, shouldCancelSwipeClick, shouldRevealSwipeActions, shouldShowSwipeActionTray, type SwipeIntent } from "./swipe-actions";
import "./styles.css";

type ConfirmState = {
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  action: () => Promise<void>;
};

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

function navigateTo(route: WebAppRoute): void {
  replaceWebAppRoute(route);
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
  openRowId?: string;
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
  capturedPointerId?: number;
  shouldSuppressClick: boolean;
};

function NotificationListRow({
  notification,
  sourceId,
  openRowId,
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
  const currentOffset = dragOffset ?? 0;
  const isRevealingActions = shouldShowSwipeActionTray(isOpen, currentOffset);

  function closeActions(): void {
    setDragOffset(undefined);
    setOpenRowId(undefined);
  }

  function suppressNextClick(): void {
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (openRowId && openRowId !== notification.id) {
      setOpenRowId(undefined);
    }
    swipeStart.current = {
      x: event.clientX,
      y: event.clientY,
      offset: isOpen ? -SWIPE_ACTION_WIDTH : 0,
      intent: "pending",
      shouldSuppressClick: false,
    };
    suppressClick.current = false;
  }

  function releaseSwipePointerCapture(target: HTMLDivElement, start: SwipeStart): void {
    if (start.capturedPointerId !== undefined && target.hasPointerCapture(start.capturedPointerId)) {
      target.releasePointerCapture(start.capturedPointerId);
    }
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
    if (start.capturedPointerId === undefined) {
      event.currentTarget.setPointerCapture(event.pointerId);
      start.capturedPointerId = event.pointerId;
    }
    if (shouldCancelSwipeClick(deltaX, deltaY, start.intent)) start.shouldSuppressClick = true;
    setDragOffset(clampSwipeOffset(start.offset + deltaX));
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>): void {
    const start = swipeStart.current;
    swipeStart.current = undefined;
    if (!start) return;
    releaseSwipePointerCapture(event.currentTarget, start);
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (start.intent !== "horizontal") {
      setDragOffset(undefined);
      suppressClick.current = false;
      return;
    }
    if (shouldCancelSwipeClick(deltaX, deltaY, start.intent)) start.shouldSuppressClick = true;
    const nextOffset = clampSwipeOffset(start.offset + deltaX);
    setDragOffset(undefined);
    setOpenRowId(shouldRevealSwipeActions(nextOffset) ? notification.id : undefined);
    if (start.shouldSuppressClick) suppressNextClick();
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>): void {
    const start = swipeStart.current;
    swipeStart.current = undefined;
    if (start) releaseSwipePointerCapture(event.currentTarget, start);
    setDragOffset(undefined);
    suppressClick.current = false;
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

  return (
    <div className={`listen-swipe-row ${isOpen ? "is-open" : ""} ${isRevealingActions ? "is-revealing" : ""}`}>
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
        onPointerCancel={handlePointerCancel}
      >
        <DataListRow
          title={(
            <span className={`listen-notification-title ${notification.openedAt ? "" : "unread"}`}>
              {notification.openedAt ? null : <span className="listen-unread-dot" aria-hidden="true" />}
              <span>{notification.title}</span>
            </span>
          )}
          description={notification.shortDescription}
          meta={isRevealingActions ? undefined : <NotificationTimestamp value={notification.createdAt} />}
          onClick={handleRowClick}
        />
      </div>
    </div>
  );
}

function useSources(): [SourceResponse[], () => Promise<void>] {
  const [sources, setSources] = useState<SourceResponse[]>([]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await appJson<{ sources: SourceResponse[] }>("/api/sources", { signal });
    if (signal?.aborted) return;
    setSources(response.sources);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch((error) => {
      if (!controller.signal.aborted) console.error("Could not load sources", error);
    });
    return () => controller.abort();
  }, [refresh]);
  return [sources, refresh];
}

type NotificationLoader = {
  result?: NotificationCollectionState;
  loading: boolean;
  loadingMore: boolean;
  error?: Error;
  loadMoreError?: Error;
  refresh: () => Promise<void>;
  retry: () => Promise<void>;
  loadNext: () => Promise<void>;
  updateNotification: (notification: NotificationListItem) => void;
  removeNotification: (notificationId: string) => void;
};

function toNotificationLoadError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Could not load notifications");
}

function useNotifications(sourceId?: string): NotificationLoader {
  const [collection, setCollection] = useState<NotificationCollectionState>(() => resetNotificationCollection(sourceId));
  const collectionRef = useRef(collection);
  const activeRequestRef = useRef<AbortController | undefined>(undefined);
  const requestGenerationRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error>();
  const [loadMoreError, setLoadMoreError] = useState<Error>();
  const [loaded, setLoaded] = useState(false);

  function commitCollection(next: NotificationCollectionState): void {
    collectionRef.current = next;
    setCollection(next);
  }

  function beginRequest(): { controller: AbortController; generation: number } {
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    return { controller, generation };
  }

  function ownsRequest(controller: AbortController, generation: number): boolean {
    return activeRequestRef.current === controller && requestGenerationRef.current === generation;
  }

  function isCurrentRequest(controller: AbortController, generation: number): boolean {
    return ownsRequest(controller, generation) && !controller.signal.aborted;
  }

  const requestPage = useCallback(async (offset: number, signal: AbortSignal): Promise<NotificationListResponse> => {
    const params = new URLSearchParams({
      limit: String(LIST_NOTIFICATIONS_DEFAULT_LIMIT),
      offset: String(offset),
    });
    if (sourceId) params.set("sourceId", sourceId);
    return appJson<NotificationListResponse>(`/api/notifications?${params}`, { signal });
  }, [sourceId]);

  const refreshInternal = useCallback(async (reset: boolean): Promise<void> => {
    if (reset) {
      commitCollection(resetNotificationCollection(sourceId));
      setLoading(true);
      setError(undefined);
      setLoadMoreError(undefined);
      setLoaded(false);
    }
    loadingMoreRef.current = false;
    setLoadingMore(false);
    const { controller, generation } = beginRequest();
    try {
      const response = await requestPage(0, controller.signal);
      if (!isCurrentRequest(controller, generation)) return;
      const next = reset
        ? createNotificationCollectionState(response, sourceId)
        : mergeNotificationPage(collectionRef.current, response);
      commitCollection(next);
      setLoaded(true);
      syncAppBadgeFromUnreadCount(response.unreadCount);
      setError(undefined);
      setLoadMoreError(undefined);
    } catch (requestError) {
      if (!isCurrentRequest(controller, generation)) return;
      setError(toNotificationLoadError(requestError));
    } finally {
      if (!ownsRequest(controller, generation)) return;
      activeRequestRef.current = undefined;
      setLoading(false);
    }
  }, [requestPage, sourceId]);

  const refresh = useCallback(async (): Promise<void> => {
    await refreshInternal(false);
  }, [refreshInternal]);

  const retry = useCallback(async (): Promise<void> => {
    const current = collectionRef.current;
    await refreshInternal(current.total === 0 && current.notifications.length === 0);
  }, [refreshInternal]);

  const loadNext = useCallback(async (): Promise<void> => {
    if (loadingMoreRef.current) return;
    const offset = collectionRef.current.nextOffset;
    if (offset === undefined) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(undefined);
    const { controller, generation } = beginRequest();
    try {
      const response = await requestPage(offset, controller.signal);
      if (!isCurrentRequest(controller, generation)) return;
      commitCollection(mergeNotificationPage(collectionRef.current, response));
      syncAppBadgeFromUnreadCount(response.unreadCount);
      setError(undefined);
    } catch (requestError) {
      if (!isCurrentRequest(controller, generation)) return;
      setLoadMoreError(toNotificationLoadError(requestError));
    } finally {
      if (!ownsRequest(controller, generation)) return;
      activeRequestRef.current = undefined;
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [requestPage]);

  const updateNotification = useCallback((notification: NotificationListItem): void => {
    commitCollection(replaceNotification(collectionRef.current, notification));
  }, []);

  const removeLoadedNotification = useCallback((notificationId: string): void => {
    commitCollection(removeNotification(collectionRef.current, notificationId));
  }, []);

  useEffect(() => {
    const reset = resetNotificationCollection(sourceId);
    commitCollection(reset);
    setLoading(true);
    setError(undefined);
    setLoadMoreError(undefined);
    setLoaded(false);
    void refreshInternal(true);
    return () => {
      activeRequestRef.current?.abort();
      activeRequestRef.current = undefined;
      requestGenerationRef.current += 1;
    };
  }, [refreshInternal, sourceId]);

  return {
    result: loaded && collection.sourceId === sourceId ? collection : undefined,
    loading: loading || collection.sourceId !== sourceId,
    loadingMore,
    error,
    loadMoreError,
    refresh,
    retry,
    loadNext,
    updateNotification,
    removeNotification: removeLoadedNotification,
  };
}

function InboxView({ route, refreshSources, requestConfirm }: { route: WebAppRoute; refreshSources: () => Promise<void>; requestConfirm: (confirm: ConfirmState) => void }) {
  const sourceId = typeof route.sourceId === "string" ? route.sourceId : undefined;
  const {
    result,
    loading,
    loadingMore,
    error,
    loadMoreError,
    refresh: refreshNotifications,
    retry,
    loadNext,
    updateNotification,
    removeNotification,
  } = useNotifications(sourceId);
  const [openRowId, setOpenRowId] = useState<string>();
  useRealtimeRefresh({
    resources: ["notifications", "sources"],
    refresh: async () => {
      await Promise.all([refreshSources(), refreshNotifications()]);
    },
  });
  useEffect(() => {
    if (!openRowId) return undefined;
    function closeOpenRowFromDocumentPointer(event: PointerEvent): void {
      if (event.target instanceof Element && event.target.closest(".listen-swipe-row")) return;
      setOpenRowId(undefined);
    }
    document.addEventListener("pointerdown", closeOpenRowFromDocumentPointer);
    return () => document.removeEventListener("pointerdown", closeOpenRowFromDocumentPointer);
  }, [openRowId]);
  const notifications = result?.notifications ?? [];

  async function markNotificationOpened(notification: NotificationListItem): Promise<void> {
    const action = notification.openedAt ? "unread" : "read";
    const response = await appJson<{ notification: NotificationListItem }>(`/api/notifications/${encodeURIComponent(notification.id)}/${action}`, { method: "POST" });
    updateNotification(response.notification);
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
        await appJson(`/api/notifications/${encodeURIComponent(notification.id)}`, { method: "DELETE" });
        removeNotification(notification.id);
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
      {!result && loading ? (
        <Panel><LoadingState title="Loading notifications" /></Panel>
      ) : null}
      {!result && error ? (
        <Panel>
          <ErrorState
            title="Could not load notifications"
            description={error.message}
            action={<Button type="button" loading={loading} onClick={() => void retry()}>Retry</Button>}
          />
        </Panel>
      ) : null}
      {result && error ? (
        <ErrorState
          title="Could not refresh notifications"
          description={error.message}
          action={<Button type="button" onClick={() => void retry()}>Retry</Button>}
        />
      ) : null}
      {notifications.length > 0 ? (
        <Panel>
          <DataList>
            {notifications.map((notification) => (
              <NotificationListRow
                key={notification.id}
                notification={notification}
                sourceId={sourceId}
                openRowId={openRowId}
                isOpen={openRowId === notification.id}
                setOpenRowId={setOpenRowId}
                markNotificationOpened={markNotificationOpened}
                requestDeleteNotification={requestDeleteNotification}
              />
            ))}
          </DataList>
        </Panel>
      ) : null}
      {result && result.total === 0 && !loading && !error ? (
        <Panel><EmptyState title="No notifications" description="New notifications will appear here." /></Panel>
      ) : null}
      {result && result.nextOffset !== undefined ? (
        <Panel className="listen-pagination">
          <div className="listen-pagination-controls">
            <span className="listen-pagination-summary" role="status">
              Showing {Math.min(notifications.length, result.total)} of {result.total} notifications
            </span>
            <Button type="button" loading={loadingMore} onClick={() => void loadNext()}>
              {loadingMore ? "Loading..." : "Load more"}
            </Button>
          </div>
          {loadMoreError ? (
            <ErrorState
              title="Could not load more notifications"
              description={loadMoreError.message}
              action={<Button type="button" onClick={() => void loadNext()}>Retry</Button>}
            />
          ) : null}
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
    const response = await appJson<{ notification: NotificationDetail }>(`/api/notifications/${encodeURIComponent(id)}`, { signal });
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
      const response = await appJson<SourceMutationResponse>("/api/sources", { method: "POST", body: JSON.stringify({ name: trimmed }) });
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
        const response = await appJson<SourceMutationResponse>(`/api/sources/${encodeURIComponent(source.id)}/token/rotate`, { method: "POST" });
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
        await appJson(`/api/sources/${encodeURIComponent(source.id)}`, { method: "DELETE" });
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
    await appJson(`/api/notifications/read${params.size ? `?${params}` : ""}`, { method: "POST" });
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
        await appJson(`/api/notifications${params.size ? `?${params}` : ""}`, { method: "DELETE" });
      },
    });
  }

  async function markNotificationUnread(route: WebAppRoute): Promise<void> {
    const id = typeof route.id === "string" ? route.id : "";
    if (!id) return;
    await appJson(`/api/notifications/${encodeURIComponent(id)}/unread`, { method: "POST" });
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
        await appJson(`/api/notifications/${encodeURIComponent(id)}`, { method: "DELETE" });
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
    await confirmState.action();
    setConfirmState(undefined);
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
