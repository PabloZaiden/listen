import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NotificationDetail, NotificationListItem } from "@listen/contracts";
import { LIST_NOTIFICATIONS_DEFAULT_LIMIT } from "@listen/shared";
import { appJson, useLiveQuery } from "@pablozaiden/webapp/web";
import {
  createNotificationCollectionState,
  mergeNotificationPage,
  removeNotification,
  replaceNotification,
  type NotificationCollectionState,
  type NotificationListResponse,
} from "../notification-pagination";

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

export type NotificationActions = {
  getDetail: (notificationId: string, signal?: AbortSignal) => Promise<NotificationDetail>;
  markReadState: (notification: NotificationListItem) => Promise<NotificationListItem>;
  markUnread: (notificationId: string) => Promise<NotificationListItem>;
  deleteNotification: (notificationId: string) => Promise<void>;
  markAllAsRead: (sourceId?: string) => Promise<number>;
  deleteAll: (sourceId?: string) => Promise<void>;
};

export type NotificationLoader = {
  result?: NotificationCollectionState;
  loading: boolean;
  loadingMore: boolean;
  error?: Error;
  loadMoreError?: Error;
  retry: () => Promise<void>;
  loadNext: () => Promise<void>;
  actions: NotificationActions;
};

async function loadNotificationCollection({
  sourceId,
  previous,
  minimumLoaded,
  signal,
}: {
  sourceId?: string;
  previous?: NotificationCollectionState;
  minimumLoaded: number;
  signal: AbortSignal;
}): Promise<NotificationCollectionState> {
  const current = previous?.sourceId === sourceId ? previous : undefined;
  let collection: NotificationCollectionState | undefined;
  let offset = 0;
  let required = Math.max(LIST_NOTIFICATIONS_DEFAULT_LIMIT, minimumLoaded, current?.loadedThrough ?? 0);
  do {
    const params = new URLSearchParams({
      limit: String(LIST_NOTIFICATIONS_DEFAULT_LIMIT),
      offset: String(offset),
    });
    if (sourceId) params.set("sourceId", sourceId);
    const response = await appJson<NotificationListResponse>(`/api/notifications?${params}`, { signal });
    if (!collection && current) {
      required = Math.max(required, current.loadedThrough + Math.max(0, response.pagination.total - current.total));
    }
    collection = collection
      ? mergeNotificationPage(collection, response)
      : createNotificationCollectionState(response, sourceId);
    offset = collection.nextOffset ?? 0;
  } while (offset > 0 && offset < required);
  return collection;
}

export function useNotifications(sourceId?: string): NotificationLoader {
  const requestedDepth = useRef<{ sourceId?: string; count: number }>({ sourceId, count: 0 });
  const [paginationRead, setPaginationRead] = useState(false);
  const { data, loading, error, refresh, mutate } = useLiveQuery<NotificationCollectionState>({
    deps: [sourceId],
    load: (signal, previous) => loadNotificationCollection({
      sourceId,
      previous,
      minimumLoaded: requestedDepth.current.sourceId === sourceId ? requestedDepth.current.count : 0,
      signal,
    }),
    // Unread counts are user-wide, including notifications outside the current source filter.
    realtime: { resources: ["notifications"] },
  });
  const result = data?.sourceId === sourceId ? data : undefined;

  useEffect(() => {
    if (result) syncAppBadgeFromUnreadCount(result.unreadCount);
  }, [result]);

  useEffect(() => {
    requestedDepth.current = { sourceId, count: 0 };
  }, [sourceId]);

  useEffect(() => {
    setPaginationRead(false);
  }, [data, sourceId]);

  const loadNext = useCallback(async (): Promise<void> => {
    if (loading || !result || result.nextOffset === undefined) return;
    requestedDepth.current = {
      sourceId,
      count: result.nextOffset + LIST_NOTIFICATIONS_DEFAULT_LIMIT,
    };
    setPaginationRead(true);
    await refresh();
  }, [loading, refresh, result, sourceId]);

  const getDetail = useCallback(async (notificationId: string, signal?: AbortSignal): Promise<NotificationDetail> => {
    return mutate(async (mutationSignal) => {
      const response = await appJson<{ notification: NotificationDetail }>(`/api/notifications/${encodeURIComponent(notificationId)}`, {
        signal: signal ? AbortSignal.any([signal, mutationSignal]) : mutationSignal,
      });
      return response.notification;
    }, (current, notification) => current ? replaceNotification(current, notification) : undefined);
  }, [mutate, sourceId]);

  const markReadState = useCallback(async (notification: NotificationListItem): Promise<NotificationListItem> => {
    const action = notification.readAt ? "unread" : "read";
    return mutate(async (signal) => {
      const response = await appJson<{ notification: NotificationListItem }>(`/api/notifications/${encodeURIComponent(notification.id)}/${action}`, { method: "POST", signal });
      return response.notification;
    }, (current, updated) => current ? replaceNotification(current, updated) : undefined);
  }, [mutate]);

  const markUnread = useCallback(async (notificationId: string): Promise<NotificationListItem> => {
    return mutate(async (signal) => {
      const response = await appJson<{ notification: NotificationListItem }>(`/api/notifications/${encodeURIComponent(notificationId)}/unread`, { method: "POST", signal });
      return response.notification;
    }, (current, notification) => current ? replaceNotification(current, notification) : undefined);
  }, [mutate]);

  const deleteNotification = useCallback(async (notificationId: string): Promise<void> => {
    await mutate(
      (signal) => appJson(`/api/notifications/${encodeURIComponent(notificationId)}`, { method: "DELETE", signal }),
      (current) => current ? removeNotification(current, notificationId) : undefined,
    );
  }, [mutate]);

  const markAllAsRead = useCallback(async (filterSourceId?: string): Promise<number> => {
    return mutate(async (signal) => {
      const params = new URLSearchParams();
      if (filterSourceId) params.set("sourceId", filterSourceId);
      const response = await appJson<{ updatedCount?: number }>(`/api/notifications/read${params.size ? `?${params}` : ""}`, { method: "POST", signal });
      return response.updatedCount ?? 0;
    });
  }, [mutate]);

  const deleteAll = useCallback(async (filterSourceId?: string): Promise<void> => {
    await mutate(async (signal) => {
      const params = new URLSearchParams();
      if (filterSourceId) params.set("sourceId", filterSourceId);
      await appJson(`/api/notifications${params.size ? `?${params}` : ""}`, { method: "DELETE", signal });
    });
  }, [mutate]);

  const actions = useMemo(
    () => ({ getDetail, markReadState, markUnread, deleteNotification, markAllAsRead, deleteAll }),
    [deleteAll, deleteNotification, getDetail, markAllAsRead, markReadState, markUnread],
  );

  return {
    result,
    loading: loading || (data !== undefined && !result),
    loadingMore: paginationRead && loading,
    error: paginationRead ? undefined : error,
    loadMoreError: paginationRead ? error : undefined,
    retry: refresh,
    loadNext,
    actions,
  };
}
