import { useEffect, useState } from "react";
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
  useToast,
  type WebAppRoute,
} from "@pablozaiden/webapp/web";
import { requestNotificationDelete } from "../actions/notification-actions";
import { NotificationListRow } from "../components/notification-list-row";
import type { ConfirmState } from "../hooks/use-confirmation";
import type { NotificationLoader } from "../hooks/use-notifications";
import { mutationErrorMessage, useMutationTracker } from "../mutation-state";
import { notificationRoute } from "./route-utils";

function notificationReadMutationKey(notificationId: string): string {
  return `notification:${notificationId}:read-state`;
}

export type InboxViewProps = {
  route: WebAppRoute;
  requestConfirm: (confirm: ConfirmState) => void;
  notifications: NotificationLoader;
};

export function InboxView({
  route,
  requestConfirm,
  notifications: notificationLoader,
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
    retry,
    loadNext,
    actions: notificationActions,
  } = notificationLoader;
  const [openRowId, setOpenRowId] = useState<string>();

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
      try {
        await notificationActions.markReadState(notification);
      } catch (mutationError) {
        toast.error(mutationErrorMessage(mutationError, `Could not mark notification as ${action}.`));
        return false;
      }
      setOpenRowId(undefined);
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
      onDeleted: () => {
        setOpenRowId(undefined);
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
