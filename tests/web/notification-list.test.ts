import { describe, expect, test } from "bun:test";
import type { NotificationListItem } from "@listen/contracts";
import { filterNotifications, groupNotifications, notificationGroupName, notificationMatchesSearch } from "../../src/web/notificationList";

function notification(overrides: Partial<NotificationListItem>): NotificationListItem {
  return {
    id: "n1",
    title: "Build finished",
    shortDescription: "CI completed",
    source: "CI Pipeline",
    sourceId: "source-1",
    createdAt: "2026-06-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("notification list helpers", () => {
  test("groups notifications by day", () => {
    const now = new Date("2026-06-20T12:00:00.000Z");

    expect(notificationGroupName("2026-06-20T01:00:00.000Z", now)).toBe("Today");
    expect(notificationGroupName("2026-06-19T23:00:00.000Z", now)).toBe("Yesterday");
    expect(notificationGroupName("2026-06-10T23:00:00.000Z", now)).toBe("Older");
  });

  test("searches title description and source only", () => {
    expect(notificationMatchesSearch(notification({ title: "Review needed" }), "review")).toBe(true);
    expect(notificationMatchesSearch(notification({ shortDescription: "Long summary" }), "summary")).toBe(true);
    expect(notificationMatchesSearch(notification({ source: "Release Automation" }), "release")).toBe(true);
    expect(notificationMatchesSearch(notification({}), "markdown-only")).toBe(false);
  });

  test("filters by read state, source, and search", () => {
    const unread = notification({ id: "unread" });
    const read = notification({ id: "read", openedAt: "2026-06-20T11:00:00.000Z" });
    const otherSource = notification({ id: "other", sourceId: "source-2", source: "Bot" });

    expect(filterNotifications([unread, read, otherSource], { filter: "unread", sourceId: "source-1", search: "build" }).map((item) => item.id)).toEqual(["unread"]);
    expect(filterNotifications([unread, read, otherSource], { filter: "read", sourceId: "", search: "" }).map((item) => item.id)).toEqual(["read"]);
  });

  test("returns non-empty groups in display order", () => {
    const groups = groupNotifications([
      notification({ id: "old", createdAt: "2026-06-10T10:00:00.000Z" }),
      notification({ id: "today", createdAt: "2026-06-20T10:00:00.000Z" }),
    ], new Date("2026-06-20T12:00:00.000Z"));

    expect(groups.map((group) => group.name)).toEqual(["Today", "Older"]);
  });
});
