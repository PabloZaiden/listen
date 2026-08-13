import { useCallback, useMemo, useState } from "react";
import {
  ConfirmModal,
  WebAppRoot,
  replaceWebAppRoute,
  renderWebApp,
  useToast,
  type ActionMenuItem,
  type SidebarNode,
  type WebAppRoute,
} from "@pablozaiden/webapp/web";
import "@pablozaiden/webapp/web/styles.css";
import { LISTEN_VERSION } from "../version";
import listenLogo from "./icons/listen.svg";
import "./app-badge";
import { buildInboxActions } from "./actions/inbox-actions";
import { buildNotificationActions, requestNotificationDelete } from "./actions/notification-actions";
import { BrowserPushSettings } from "./browserPushSettings";
import { useConfirmation } from "./hooks/use-confirmation";
import { useNotificationActions, type NotificationRefreshOptions } from "./hooks/use-notifications";
import { useSources } from "./hooks/use-sources";
import { InboxView } from "./routes/inbox";
import { NotificationView } from "./routes/notification";
import { SourcesView } from "./routes/sources";
import { sourceFilterRoute, sourceIdFromRoute } from "./routes/route-utils";
import { mutationErrorMessage, useMutationTracker } from "./mutation-state";
import "./styles.css";

function navigateTo(route: WebAppRoute): void {
  replaceWebAppRoute(route);
}

function ListenApp(): React.ReactElement {
  const toast = useToast();
  const {
    sources,
    loading: sourcesLoading,
    error: sourcesError,
    refresh: refreshSources,
    createSource,
    rotateSourceToken,
    deleteSource: deleteSourceRequest,
  } = useSources();
  const notificationActions = useNotificationActions();
  const { confirmState, confirmBusy, requestConfirm, closeConfirm, runConfirm } = useConfirmation();
  const [notificationRefreshRequest, setNotificationRefreshRequest] = useState({
    token: 0,
    reset: false,
  });
  const [currentRoute, setCurrentRoute] = useState<WebAppRoute>({ view: "inbox" });
  const headerMutations = useMutationTracker();

  const requestNotificationRefresh = useCallback((options: NotificationRefreshOptions = {}): void => {
    setNotificationRefreshRequest((current) => ({
      token: current.token + 1,
      reset: options.reset === true,
    }));
  }, []);

  function selectedSourceName(sourceId: string | undefined): string | undefined {
    return sources.find((source) => source.id === sourceId)?.name;
  }

  async function markAllAsRead(sourceId: string | undefined): Promise<void> {
    const mutationKey = `notifications:read:${sourceId ?? "all"}`;
    if (!headerMutations.start(mutationKey)) return;
    try {
      const updatedCount = await notificationActions.markAllAsRead(sourceId);
      requestNotificationRefresh();
      toast.success(updatedCount === 1 ? "1 notification marked as read." : `${updatedCount} notifications marked as read.`);
    } catch (error) {
      toast.error(mutationErrorMessage(error, "Could not mark notifications as read."));
    } finally {
      headerMutations.finish(mutationKey);
    }
  }

  function deleteAll(sourceId: string | undefined): void {
    const sourceName = selectedSourceName(sourceId);
    requestConfirm({
      title: sourceName ? `Delete ${sourceName} notifications?` : "Delete all notifications?",
      description: "This cannot be undone.",
      confirmLabel: "Delete all",
      danger: true,
      successMessage: "Notifications deleted.",
      action: async () => {
        await notificationActions.deleteAll(sourceId);
        requestNotificationRefresh({ reset: true });
      },
    });
  }

  async function markNotificationUnread(route: WebAppRoute): Promise<void> {
    const id = typeof route.id === "string" ? route.id : "";
    if (!id) return;
    const mutationKey = `notification:${id}:unread`;
    if (!headerMutations.start(mutationKey)) return;
    try {
      await notificationActions.markUnread(id);
      requestNotificationRefresh();
      navigateTo(sourceFilterRoute(sourceIdFromRoute(route)));
      toast.success("Notification marked as unread.");
    } catch (error) {
      toast.error(mutationErrorMessage(error, "Could not mark notification as unread."));
    } finally {
      headerMutations.finish(mutationKey);
    }
  }

  function deleteNotification(route: WebAppRoute): void {
    const id = typeof route.id === "string" ? route.id : "";
    if (!id) return;
    requestNotificationDelete(id, {
      requestConfirm,
      deleteNotification: notificationActions.deleteNotification,
      onDeleted: () => {
        requestNotificationRefresh();
        navigateTo(sourceFilterRoute(sourceIdFromRoute(route)));
      },
    });
  }

  const sidebarNodes = useCallback((): SidebarNode[] => {
    const sourceId = currentRoute.view === "inbox" ? sourceIdFromRoute(currentRoute) : undefined;
    const markAllReadKey = `notifications:read:${sourceId ?? "all"}`;
    return [
      {
        type: "item",
        id: "inbox",
        title: "Inbox",
        route: { view: "inbox" },
        actions: buildInboxActions({
          markAllReadBusy: headerMutations.isBusy(markAllReadKey),
          confirmBusy,
          onMarkAllRead: () => { void markAllAsRead(sourceId); },
          onDeleteAll: () => deleteAll(sourceId),
        }),
      },
      { type: "item", id: "sources", title: "Sources", route: { view: "sources" } },
    ];
  }, [confirmBusy, currentRoute, headerMutations, notificationActions, requestNotificationRefresh, sources, toast]);

  const headerActions = useCallback((route: WebAppRoute): ActionMenuItem[] => {
    if (route.view !== "notification") return [];
    const id = typeof route.id === "string" ? route.id : "";
    const markUnreadKey = `notification:${id}:unread`;
    return buildNotificationActions({
      id,
      markUnreadBusy: headerMutations.isBusy(markUnreadKey),
      confirmBusy,
      onMarkUnread: () => { void markNotificationUnread(route); },
      onDelete: () => deleteNotification(route),
    });
  }, [confirmBusy, headerMutations, notificationActions, requestNotificationRefresh, sources, toast]);

  const routes = useMemo(() => ({
    inbox: (route: WebAppRoute) => (
      <InboxView
        route={route}
        requestConfirm={requestConfirm}
        notificationRefreshRequest={notificationRefreshRequest}
        notificationActions={notificationActions}
      />
    ),
    notification: (route: WebAppRoute) => <NotificationView route={route} notificationActions={notificationActions} />,
    sources: () => (
      <SourcesView
        sources={sources}
        loading={sourcesLoading}
        error={sourcesError}
        refreshSources={refreshSources}
        createSource={createSource}
        rotateSourceToken={rotateSourceToken}
        deleteSourceRequest={deleteSourceRequest}
        requestConfirm={requestConfirm}
      />
    ),
  }), [createSource, deleteSourceRequest, notificationActions, notificationRefreshRequest, refreshSources, requestConfirm, rotateSourceToken, sources, sourcesError, sourcesLoading]);

  return (
    <>
      <WebAppRoot
        appName="Listen"
        appIcon={listenLogo}
        homeRoute={{ view: "inbox" }}
        version={LISTEN_VERSION}
        sidebar={{ getNodes: sidebarNodes, search: false }}
        routes={routes}
        onRouteChange={setCurrentRoute}
        header={{
          renderTitle: ({ route }) => {
            if (route.view === "settings") return "Settings";
            if (route.view === "sources") return "Sources";
            if (route.view === "notification") return "Notification";
            const sourceId = sourceIdFromRoute(route);
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
        <ConfirmModal
          isOpen
          title={confirmState.title}
          message={confirmState.description ?? confirmState.title}
          confirmLabel={confirmState.confirmLabel}
          variant={confirmState.danger ? "danger" : "primary"}
          loading={confirmBusy}
          onClose={closeConfirm}
          onConfirm={() => { void runConfirm(); }}
        />
      ) : null}
    </>
  );
}

renderWebApp(<ListenApp />);
