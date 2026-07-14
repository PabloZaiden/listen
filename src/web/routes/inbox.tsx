import { useEffect, useRef, useState } from "react";
import type { NotificationListItem } from "@listen/contracts";
import {
  Button,
  DataList,
  EmptyState,
  ErrorState,
  LoadingState,
  Page,
  Panel,
  replaceWebAppRoute,
  useRealtimeRefresh,
  useToast,
  type WebAppRoute,
} from "@pablozaiden/webapp/web";
import { requestNotificationDelete } from "../actions/notification-actions";
import { NotificationListRow } from "../components/notification-list-row";
import type { ConfirmState } from "../hooks/use-confirmation";
import { useNotifications, type NotificationActions } from "../hooks/use-notifications";
import { mutationErrorMessage, useMutationTracker } from "../mutation-state";
import { notificationRoute } from "./route-utils";

function notificationReadMutationKey(notificationId: string): string {
  return `notification:${notificationId}:read-state`;
}

export type InboxViewProps = {
  route: WebAppRoute;
  refreshSources: () => Promise<void>;
  requestConfirm: (confirm: ConfirmState) => void;
  notificationRefreshToken: number;
  notificationActions: NotificationActions;
};

export function InboxView({
  route,
  refreshSources,
  requestConfirm,
  notificationRefreshToken,
  notificationActions,
}: InboxViewProps) {
  const toast = useToast();
  const notificationMutations = useMutationTracker();
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
      const [sourcesResult, notificationsResult] = await Promise.allSettled([
        refreshSources(),
        refreshNotifications(),
      ]);
      if (sourcesResult.status === "rejected") {
        toast.error(mutationErrorMessage(sourcesResult.reason, "Could not refresh sources."));
      }
      if (notificationsResult.status === "rejected") {
        toast.error(mutationErrorMessage(notificationsResult.reason, "Could not refresh notifications."));
      }
    },
  });

  const lastNotificationRefreshToken = useRef(notificationRefreshToken);
  useEffect(() => {
    if (lastNotificationRefreshToken.current === notificationRefreshToken) return;
    lastNotificationRefreshToken.current = notificationRefreshToken;
    void refreshNotifications().catch((refreshError) => {
      toast.error(mutationErrorMessage(refreshError, "Could not refresh notifications."));
    });
  }, [notificationRefreshToken, refreshNotifications, toast]);

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

  function reportNotificationMutationError(error: unknown): void {
    toast.error(mutationErrorMessage(error, "Could not update the notification."));
  }

  async function toggleNotificationReadState(notification: NotificationListItem, mutationKey: string): Promise<boolean> {
    const action = notification.readAt ? "unread" : "read";
    if (!notificationMutations.start(mutationKey)) return false;
    try {
      let updatedNotification: NotificationListItem;
      try {
        updatedNotification = await notificationActions.markReadState(notification);
      } catch (mutationError) {
        toast.error(mutationErrorMessage(mutationError, `Could not mark notification as ${action}.`));
        return false;
      }
      updateNotification(updatedNotification);
      setOpenRowId(undefined);
      try {
        await refreshNotifications();
      } catch (refreshError) {
        toast.error(mutationErrorMessage(refreshError, `Notification marked as ${action}, but could not refresh notifications.`));
      }
      return true;
    } finally {
      notificationMutations.finish(mutationKey);
    }
  }

  function retryNotifications(): void {
    void retry().catch((retryError: unknown) => {
      toast.error(mutationErrorMessage(retryError, "Could not refresh notifications."));
    });
  }

  function loadNextNotifications(): void {
    void loadNext().catch((loadError: unknown) => {
      toast.error(mutationErrorMessage(loadError, "Could not load more notifications."));
    });
  }

  function requestDeleteNotification(notification: NotificationListItem): void {
    requestNotificationDelete(notification.id, {
      requestConfirm,
      deleteNotification: notificationActions.deleteNotification,
      onDeleted: async () => {
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
            action={<Button type="button" loading={loading} onClick={retryNotifications}>Retry</Button>}
          />
        </Panel>
      ) : null}
      {result && error ? (
        <ErrorState
          title="Could not refresh notifications"
          description={error.message}
          action={<Button type="button" onClick={retryNotifications}>Retry</Button>}
        />
      ) : null}
      {notifications.length > 0 ? (
        <Panel>
          <DataList>
            {notifications.map((notification) => {
              const mutationKey = notificationReadMutationKey(notification.id);
              return (
                <NotificationListRow
                  key={notification.id}
                  notification={notification}
                  openRowId={openRowId}
                  isOpen={openRowId === notification.id}
                  setOpenRowId={setOpenRowId}
                  toggleNotificationReadState={toggleNotificationReadState}
                  notificationMutationKey={mutationKey}
                  notificationMutationBusy={notificationMutations.isBusy(mutationKey)}
                  reportMutationError={reportNotificationMutationError}
                  requestDeleteNotification={requestDeleteNotification}
                  onOpen={() => replaceWebAppRoute(notificationRoute(notification.id, sourceId))}
                />
              );
            })}
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
            <Button type="button" loading={loadingMore} onClick={loadNextNotifications}>
              {loadingMore ? "Loading..." : "Load more"}
            </Button>
          </div>
          {loadMoreError ? (
            <ErrorState
              title="Could not load more notifications"
              description={loadMoreError.message}
              action={<Button type="button" onClick={loadNextNotifications}>Retry</Button>}
            />
          ) : null}
        </Panel>
      ) : null}
    </Page>
  );
}
