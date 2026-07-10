import { describe, expect, test } from "bun:test";
import {
  SWIPE_ACTION_WIDTH,
  clampSwipeOffset,
  detectSwipeIntent,
  shouldCancelSwipeClick,
  shouldRevealSwipeActions,
  shouldShowSwipeActionTray,
} from "../../src/web/swipe-actions";

describe("notification swipe actions", () => {
  test("clamps swipes to the action tray width", () => {
    expect(clampSwipeOffset(24)).toBe(0);
    expect(clampSwipeOffset(-24)).toBe(-24);
    expect(clampSwipeOffset(-SWIPE_ACTION_WIDTH - 40)).toBe(-SWIPE_ACTION_WIDTH);
  });

  test("detects horizontal swipes without stealing vertical scrolling", () => {
    expect(detectSwipeIntent(-4, 2)).toBe("pending");
    expect(detectSwipeIntent(-60, 12)).toBe("horizontal");
    expect(detectSwipeIntent(-16, 48)).toBe("vertical");
  });

  test("reveals actions only after a meaningful left swipe", () => {
    expect(shouldRevealSwipeActions(-24)).toBe(false);
    expect(shouldRevealSwipeActions(-80)).toBe(true);
  });

  test("shows the action tray only while dragged left or open", () => {
    expect(shouldShowSwipeActionTray(false, 0)).toBe(false);
    expect(shouldShowSwipeActionTray(false, 24)).toBe(false);
    expect(shouldShowSwipeActionTray(false, -1)).toBe(true);
    expect(shouldShowSwipeActionTray(true, 0)).toBe(true);
  });

  test("cancels row navigation after horizontal pointer movement", () => {
    expect(shouldCancelSwipeClick(2, 3)).toBe(false);
    expect(shouldCancelSwipeClick(-12, 1)).toBe(true);
    expect(shouldCancelSwipeClick(12, 1)).toBe(true);
  });

  test("does not cancel row navigation for vertical gestures", () => {
    expect(detectSwipeIntent(2, 20)).toBe("vertical");
    expect(shouldCancelSwipeClick(2, 20)).toBe(false);
  });

  test("keeps small iPad-like pointer jitter clickable", () => {
    expect(detectSwipeIntent(7, 2)).toBe("pending");
    expect(shouldCancelSwipeClick(7, 2)).toBe(false);
    expect(shouldCancelSwipeClick(3, 9)).toBe(false);
  });
});
