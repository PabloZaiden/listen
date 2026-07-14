import { describe, expect, test } from "bun:test";
import {
  detectSwipeIntent,
  shouldCancelSwipeClick,
  shouldRevealSwipeActions,
} from "../../src/web/swipe-actions";

describe("notification swipe actions", () => {
  test("classifies clear horizontal and vertical gestures for notification rows", () => {
    expect(detectSwipeIntent(-80, 12)).toBe("horizontal");
    expect(detectSwipeIntent(8, 48)).toBe("vertical");
  });

  test("reveals actions and cancels row navigation for a clear horizontal swipe", () => {
    expect(shouldRevealSwipeActions(-80)).toBe(true);
    expect(shouldCancelSwipeClick(-80, 12)).toBe(true);
  });

  test("preserves row navigation for vertical scrolling gestures", () => {
    expect(shouldCancelSwipeClick(8, 48)).toBe(false);
  });
});
