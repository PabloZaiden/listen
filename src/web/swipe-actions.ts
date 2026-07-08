export const SWIPE_ACTION_WIDTH = 144;
export const SWIPE_REVEAL_THRESHOLD = 48;
export const SWIPE_CLICK_CANCEL_THRESHOLD = 8;
export const SWIPE_DIRECTION_THRESHOLD = 8;

export type SwipeIntent = "pending" | "horizontal" | "vertical";

export function clampSwipeOffset(offset: number, actionWidth = SWIPE_ACTION_WIDTH): number {
  return Math.min(0, Math.max(-actionWidth, offset));
}

export function detectSwipeIntent(deltaX: number, deltaY: number): SwipeIntent {
  const absoluteX = Math.abs(deltaX);
  const absoluteY = Math.abs(deltaY);
  if (absoluteX < SWIPE_DIRECTION_THRESHOLD && absoluteY < SWIPE_DIRECTION_THRESHOLD) return "pending";
  return absoluteX > absoluteY * 1.2 ? "horizontal" : "vertical";
}

export function shouldCancelSwipeClick(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaX) > SWIPE_CLICK_CANCEL_THRESHOLD || Math.abs(deltaY) > SWIPE_CLICK_CANCEL_THRESHOLD;
}

export function shouldRevealSwipeActions(offset: number, actionWidth = SWIPE_ACTION_WIDTH): boolean {
  return Math.abs(clampSwipeOffset(offset, actionWidth)) >= SWIPE_REVEAL_THRESHOLD;
}

export function shouldShowSwipeActionTray(isOpen: boolean, offset: number, actionWidth = SWIPE_ACTION_WIDTH): boolean {
  return isOpen || clampSwipeOffset(offset, actionWidth) < 0;
}
