import { describe, expect, test } from "bun:test";
import type { NotificationListItem } from "@listen/contracts";
import {
  createNotificationCollectionState,
  mergeNotificationPage,
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

});
