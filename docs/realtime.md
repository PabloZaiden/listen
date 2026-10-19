# Live inbox synchronization

Listen uses Webapp's shared application WebSocket. Sources and notifications
declare resource interests through `useLiveQuery`; Webapp updates those
subscriptions over the existing connection, waits for activation acknowledgement,
and recovers snapshots after reconnect. Notification source filters change the
query's dependency identity, not its WebSocket.

The source hook owns its source snapshot and mutations. The notification hook
owns the inbox snapshot, pagination, app badge and notification actions, including
opening detail (which marks a notification read). `ListenApp` keeps that owner
mounted across route changes. Views do not subscribe or request parallel refreshes.

Notification snapshots include the authoritative prefix covering already loaded
pages. Refreshes rebuild that prefix instead of merging a new first page into
old records. Positive total growth extends the prefix so new arrivals do not
discard loaded older pages. Pagination remains ordered and deduplicated. Route
filter changes reset the collection; reconnects preserve loaded depth.
Each page read is capped to the remaining required prefix, so individual
arrivals do not implicitly load extra pages of unrelated older history.
Notifications deliberately subscribe to all of the current user's notification
changes because unread counts and the app badge remain user-wide even on a
source-filtered route.

Webapp cancels superseded reads, rejects dirty snapshots and coalesces
invalidations into one pending follow-up. Every initiating notification/source
mutation enters its query's mutation barrier before the HTTP request; response
reconciliation and the subsequent authoritative refresh share that owner.
Snapshots started before a mutation cannot undo its result.
The detail view waits for the authoritative collection matching its route's
source filter before marking a notification read through that owner. Initial
deep links and filter changes therefore cannot start a mutation against a
retired query lifecycle. Collection failures remain visible with an explicit
retry instead of leaving the detail waiting indefinitely.

Server publications remain authenticated and user-targeted. Public webhooks
derive the target user and source from the verified webhook source, never from
caller-supplied ownership data. Browser Web Push and the service worker remain
separate from application-state delivery.
