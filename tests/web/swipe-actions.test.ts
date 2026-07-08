import { describe, expect, test } from "bun:test";
import {
  SWIPE_ACTION_WIDTH,
  clampSwipeOffset,
  detectSwipeIntent,
  shouldCancelSwipeClick,
  shouldRevealSwipeActions,
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

  test("cancels row navigation after pointer movement", () => {
    expect(shouldCancelSwipeClick(2, 3)).toBe(false);
    expect(shouldCancelSwipeClick(-12, 1)).toBe(true);
    expect(shouldCancelSwipeClick(1, 12)).toBe(true);
  });
});
