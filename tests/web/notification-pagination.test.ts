import { describe, expect, test } from "bun:test";
import type { NotificationListItem } from "@listen/contracts";
import {
  createNotificationCollectionState,
  mergeNotificationPage,
  refreshNotificationCollection,
  resetNotificationCollection,
  type NotificationListResponse,
} from "../../src/web/notification-pagination";

function notification(id: string, createdAt: string, title = id): NotificationListItem {
  return {
    id,
    title,
    shortDescription: title,
    source: "Agent",
    createdAt,
  };
}

function page(
  notifications: NotificationListItem[],
  pagination: NotificationListResponse["pagination"],
  unreadCount = 0,
): NotificationListResponse {
  return { notifications, unreadCount, pagination };
}

describe("notification pagination", () => {
  test("deduplicates overlapping pages and preserves server ordering", () => {
    const firstPage = page([
      notification("a", "2026-07-14T00:03:00.000Z"),
      notification("b", "2026-07-14T00:02:00.000Z"),
    ], { limit: 2, offset: 0, total: 4, nextOffset: 2 });
    const overlappingPage = page([
      notification("b", "2026-07-14T00:02:00.000Z", "Updated"),
      notification("c", "2026-07-14T00:01:00.000Z"),
    ], { limit: 2, offset: 1, total: 3 });

    const afterFirstPage = createNotificationCollectionState(firstPage, "source-a");
    const result = mergeNotificationPage(afterFirstPage, overlappingPage);

    expect(result.notifications.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(result.notifications.find(({ id }) => id === "b")?.title).toBe("Updated");
    expect(result.loadedThrough).toBe(3);
    expect(result.nextOffset).toBeUndefined();
  });

  test("merges a refreshed first page without dropping loaded older records", () => {
    const initial = createNotificationCollectionState(page([
      notification("a", "2026-07-14T00:03:00.000Z"),
      notification("b", "2026-07-14T00:02:00.000Z"),
    ], { limit: 2, offset: 0, total: 4, nextOffset: 2 }));
    const loadedOlderPage = mergeNotificationPage(initial, page([
      notification("c", "2026-07-14T00:01:00.000Z"),
      notification("d", "2026-07-14T00:00:00.000Z"),
    ], { limit: 2, offset: 2, total: 4 }));

    const refreshed = refreshNotificationCollection(loadedOlderPage, page([
      notification("new", "2026-07-14T00:04:00.000Z"),
      notification("a", "2026-07-14T00:03:00.000Z"),
    ], { limit: 2, offset: 0, total: 5, nextOffset: 2 }, 3));

    expect(refreshed.notifications.map(({ id }) => id)).toEqual(["new", "a", "b", "c", "d"]);
    expect(refreshed.unreadCount).toBe(3);
    expect(refreshed.total).toBe(5);
    expect(refreshed.loadedThrough).toBe(4);
    expect(refreshed.nextOffset).toBe(4);
  });

  test("replaces loaded records when a refresh reports no notifications", () => {
    const initial = createNotificationCollectionState(page([
      notification("a", "2026-07-14T00:03:00.000Z"),
      notification("b", "2026-07-14T00:02:00.000Z"),
    ], { limit: 2, offset: 0, total: 4, nextOffset: 2 }), "source-a");
    const loadedOlderPage = mergeNotificationPage(initial, page([
      notification("c", "2026-07-14T00:01:00.000Z"),
      notification("d", "2026-07-14T00:00:00.000Z"),
    ], { limit: 2, offset: 2, total: 4 }));

    const refreshed = refreshNotificationCollection(
      loadedOlderPage,
      page([], { limit: 2, offset: 0, total: 0 }),
    );

    expect(refreshed.sourceId).toBe("source-a");
    expect(refreshed.notifications).toEqual([]);
    expect(refreshed.unreadCount).toBe(0);
    expect(refreshed.total).toBe(0);
    expect(refreshed.loadedThrough).toBe(0);
    expect(refreshed.nextOffset).toBeUndefined();
  });

  test("explicit reset discards loaded pages even when the first page has records", () => {
    const initial = createNotificationCollectionState(page([
      notification("old", "2026-07-14T00:01:00.000Z"),
    ], { limit: 2, offset: 0, total: 3, nextOffset: 2 }), "source-a");
    const loadedOlderPage = mergeNotificationPage(initial, page([
      notification("older", "2026-07-14T00:00:00.000Z"),
    ], { limit: 2, offset: 2, total: 3 }));

    const refreshed = refreshNotificationCollection(
      loadedOlderPage,
      page([notification("new", "2026-07-14T00:02:00.000Z")], {
        limit: 2,
        offset: 0,
        total: 1,
      }),
      true,
    );

    expect(refreshed.notifications.map(({ id }) => id)).toEqual(["new"]);
    expect(refreshed.total).toBe(1);
    expect(refreshed.loadedThrough).toBe(1);
    expect(refreshed.nextOffset).toBeUndefined();
  });

  test("resets all loaded records and continuation state for a new source filter", () => {
    const result = resetNotificationCollection("source-b");

    expect(result).toEqual({
      sourceId: "source-b",
      notifications: [],
      unreadCount: 0,
      total: 0,
      loadedThrough: 0,
    });
  });
});
