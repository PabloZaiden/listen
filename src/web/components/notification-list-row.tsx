import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { NotificationListItem } from "@listen/contracts";
import { DataListRow } from "@pablozaiden/webapp/web";
import { SWIPE_ACTION_WIDTH, clampSwipeOffset, detectSwipeIntent, shouldCancelSwipeClick, shouldRevealSwipeActions, shouldShowSwipeActionTray, type SwipeIntent } from "../swipe-actions";

type NotificationListRowProps = {
  notification: NotificationListItem;
  openRowId?: string;
  isOpen: boolean;
  setOpenRowId: (id: string | undefined) => void;
  toggleNotificationReadState: (notification: NotificationListItem, mutationKey: string) => Promise<boolean>;
  notificationMutationKey: string;
  notificationMutationBusy: boolean;
  reportMutationError: (error: unknown) => void;
  requestDeleteNotification: (notification: NotificationListItem) => void;
  onOpen: () => void;
};

type SwipeStart = {
  x: number;
  y: number;
  offset: number;
  intent: SwipeIntent;
  capturedPointerId?: number;
  shouldSuppressClick: boolean;
};

function NotificationTimestamp({ value }: { value: string }) {
  const date = new Date(value);
  return (
    <span className="listen-notification-timestamp" aria-label={date.toLocaleString()}>
      <span>{date.toLocaleDateString()}</span>
      <span>{date.toLocaleTimeString()}</span>
    </span>
  );
}

export function NotificationListRow({
  notification,
  openRowId,
  isOpen,
  setOpenRowId,
  toggleNotificationReadState,
  notificationMutationKey,
  notificationMutationBusy,
  reportMutationError,
  requestDeleteNotification,
  onOpen,
}: NotificationListRowProps) {
  const swipeStart = useRef<SwipeStart | undefined>(undefined);
  const suppressClick = useRef(false);
  const [dragOffset, setDragOffset] = useState<number>();
  const isUnread = !notification.readAt;
  const markLabel = isUnread ? "Mark as read" : "Mark as unread";
  const currentOffset = dragOffset ?? 0;
  const isRevealingActions = shouldShowSwipeActionTray(isOpen, currentOffset);

  function closeActions(): void {
    setDragOffset(undefined);
    setOpenRowId(undefined);
  }

  function suppressNextClick(): void {
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (openRowId && openRowId !== notification.id) {
      setOpenRowId(undefined);
    }
    swipeStart.current = {
      x: event.clientX,
      y: event.clientY,
      offset: isOpen ? -SWIPE_ACTION_WIDTH : 0,
      intent: "pending",
      shouldSuppressClick: false,
    };
    suppressClick.current = false;
  }

  function releaseSwipePointerCapture(target: HTMLDivElement, start: SwipeStart): void {
    if (start.capturedPointerId !== undefined && target.hasPointerCapture(start.capturedPointerId)) {
      target.releasePointerCapture(start.capturedPointerId);
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const start = swipeStart.current;
    if (!start) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (start.intent === "pending") {
      start.intent = detectSwipeIntent(deltaX, deltaY);
    }
    if (start.intent === "vertical") return;
    if (start.intent !== "horizontal") return;
    if (start.capturedPointerId === undefined) {
      event.currentTarget.setPointerCapture(event.pointerId);
      start.capturedPointerId = event.pointerId;
    }
    if (shouldCancelSwipeClick(deltaX, deltaY, start.intent)) start.shouldSuppressClick = true;
    setDragOffset(clampSwipeOffset(start.offset + deltaX));
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>): void {
    const start = swipeStart.current;
    swipeStart.current = undefined;
    if (!start) return;
    releaseSwipePointerCapture(event.currentTarget, start);
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (start.intent !== "horizontal") {
      setDragOffset(undefined);
      suppressClick.current = false;
      return;
    }
    if (shouldCancelSwipeClick(deltaX, deltaY, start.intent)) start.shouldSuppressClick = true;
    const nextOffset = clampSwipeOffset(start.offset + deltaX);
    setDragOffset(undefined);
    setOpenRowId(shouldRevealSwipeActions(nextOffset) ? notification.id : undefined);
    if (start.shouldSuppressClick) suppressNextClick();
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>): void {
    const start = swipeStart.current;
    swipeStart.current = undefined;
    if (start) releaseSwipePointerCapture(event.currentTarget, start);
    setDragOffset(undefined);
    suppressClick.current = false;
  }

  function handleRowClick(): void {
    if (notificationMutationBusy) return;
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (isOpen) {
      closeActions();
      return;
    }
    onOpen();
  }

  async function runMarkAction(): Promise<void> {
    if (notificationMutationBusy) return;
    try {
      await toggleNotificationReadState(notification, notificationMutationKey);
    } catch (error) {
      reportMutationError(error);
    }
  }

  function runDeleteAction(): void {
    if (notificationMutationBusy) return;
    closeActions();
    requestDeleteNotification(notification);
  }

  return (
    <div className={`listen-swipe-row ${isOpen ? "is-open" : ""} ${isRevealingActions ? "is-revealing" : ""}`}>
      <div className="listen-swipe-actions" aria-hidden={!isOpen}>
        <button
          type="button"
          className="listen-swipe-action"
          tabIndex={isOpen ? 0 : -1}
          disabled={notificationMutationBusy}
          onClick={() => { void runMarkAction(); }}
        >
          {notificationMutationBusy ? "Updating..." : markLabel}
        </button>
        <button
          type="button"
          className="listen-swipe-action destructive"
          tabIndex={isOpen ? 0 : -1}
          disabled={notificationMutationBusy}
          onClick={runDeleteAction}
        >
          Delete
        </button>
      </div>
      <div
        className={`listen-swipe-content ${dragOffset === undefined ? "" : "is-dragging"}`}
        style={{ transform: `translateX(${currentOffset}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerCancel}
      >
        <DataListRow
          title={(
            <span className={`listen-notification-title ${notification.readAt ? "" : "unread"}`}>
              {notification.readAt ? null : <span className="listen-unread-dot" aria-hidden="true" />}
              <span>{notification.title}</span>
            </span>
          )}
          description={notification.shortDescription}
          meta={isRevealingActions ? undefined : <NotificationTimestamp value={notification.createdAt} />}
          onClick={handleRowClick}
        />
      </div>
    </div>
  );
}
