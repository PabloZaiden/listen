import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NotificationDetail, NotificationListItem } from "@listen/contracts";
import { LIST_NOTIFICATIONS_DEFAULT_LIMIT } from "@listen/shared";
import { appJson } from "@pablozaiden/webapp/web";
import {
  createNotificationCollectionState,
  mergeNotificationPage,
  removeNotification,
  replaceNotification,
  resetNotificationCollection,
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

export function useNotificationActions(): NotificationActions {
  const getDetail = useCallback(async (notificationId: string, signal?: AbortSignal): Promise<NotificationDetail> => {
    const response = await appJson<{ notification: NotificationDetail }>(`/api/notifications/${encodeURIComponent(notificationId)}`, { signal });
    return response.notification;
  }, []);

  const markReadState = useCallback(async (notification: NotificationListItem): Promise<NotificationListItem> => {
    const action = notification.readAt ? "unread" : "read";
    const response = await appJson<{ notification: NotificationListItem }>(`/api/notifications/${encodeURIComponent(notification.id)}/${action}`, { method: "POST" });
    return response.notification;
  }, []);

  const markUnread = useCallback(async (notificationId: string): Promise<NotificationListItem> => {
    const response = await appJson<{ notification: NotificationListItem }>(`/api/notifications/${encodeURIComponent(notificationId)}/unread`, { method: "POST" });
    return response.notification;
  }, []);

  const deleteNotification = useCallback(async (notificationId: string): Promise<void> => {
    await appJson(`/api/notifications/${encodeURIComponent(notificationId)}`, { method: "DELETE" });
  }, []);

  const markAllAsRead = useCallback(async (sourceId?: string): Promise<number> => {
    const params = new URLSearchParams();
    if (sourceId) params.set("sourceId", sourceId);
    const response = await appJson<{ updatedCount?: number }>(`/api/notifications/read${params.size ? `?${params}` : ""}`, { method: "POST" });
    return response.updatedCount ?? 0;
  }, []);

  const deleteAll = useCallback(async (sourceId?: string): Promise<void> => {
    const params = new URLSearchParams();
    if (sourceId) params.set("sourceId", sourceId);
    await appJson(`/api/notifications${params.size ? `?${params}` : ""}`, { method: "DELETE" });
  }, []);

  return useMemo(
    () => ({ getDetail, markReadState, markUnread, deleteNotification, markAllAsRead, deleteAll }),
    [deleteAll, deleteNotification, getDetail, markAllAsRead, markReadState, markUnread],
  );
}

export type NotificationLoader = {
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

export function useNotifications(sourceId?: string): NotificationLoader {
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
    void refreshInternal(true).catch((requestError) => {
      setError(toNotificationLoadError(requestError));
    });
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
