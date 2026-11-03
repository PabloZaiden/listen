# Operations

## Access and storage

Listen has one owner and one passkey. First enrollment bootstraps that account;
afterward only a verified browser session can access private APIs and realtime.
Replacing the passkey invalidates older sessions. Logout revokes the current
session. Password login, invitations, user administration, API keys, device auth,
client CLI and binary installation/updating are not supported.

Keep `/app/data` on a persistent volume. It contains the private `listen.db`,
the owner/passkey/session state, notifications, sources, VAPID keys and migration
backups. Run only one Listen process per volume. Stop the old container before
upgrading. Do not expose the data directory as static files.

App Settings contains only passkey replacement, logout, theme, browser push and
version. Browser preferences use Listen's explicitly selected browser adapter;
supported saved theme/sidebar/Settings choices retain their existing namespaces.
Server-side owner theme preferences survive migration.

## Upgrade and restore

The supported legacy input is the current multi-user Listen schema, including
notification `read_at` and framework user/passkey/ownership columns. Unsupported
older schemas fail startup explicitly; Listen does not guess an account or
silently reset data. Populated legacy databases require exactly one enabled owner.

On the first startup only, Listen creates
`backups/listen.pre-single-account.db` beneath `LISTEN_DATA_DIR`. SQLite
`VACUUM INTO` captures a consistent database snapshot, including WAL state.
The private directory/file are created with modes `0700`/`0600`, never overwritten,
and flushed before migration. Backup failure aborts startup without migration.
If an interrupted/failed attempt left this create-only filename, stop Listen
and preserve/move that file before retrying; never overwrite the recovery copy.

The migration transaction:

- assigns **all** existing sources and notifications to the existing owner;
- preserves IDs, source relationships, read timestamps, content, token hashes and
  URLs, applicable owner theme preferences, and the VAPID key pair;
- keeps only the owner's existing passkey and browser-push subscriptions;
- invalidates every old browser session and setup link and retires all API-key,
  device-auth, refresh-token and signing-key credentials;
- commits its durable completion marker only after foreign-key verification.

A failure rolls back the transaction and aborts startup. The next successful
restart does not merge again or create a second backup. Sign in with the owner's
existing passkey after upgrading. Other users' passkeys cannot log in.

For rollback, stop the new container, preserve the migrated volume separately,
and restore the pre-migration backup into an isolated recovery volume as
`listen.db`, owned by the container user with mode `0600`. Do not retain `listen.db-wal`
or `listen.db-shm` from another database. Start the previous image **only against
that restored volume**. Test restoration before relying on a backup. Running an
old binary against the migrated database is unsupported; unmodified old binaries
cannot be assumed to recognize or reject the new schema.

## Browser push and PWA

Enable notifications independently on each browser in Settings. The service
worker at `/service-worker` owns push display, click navigation and badges.
Webapp serves `/site.webmanifest`, app icons and Apple touch icon as public assets.
VAPID keys are generated once and persisted; subscriptions survive container
restart. On iOS/iPadOS, install to the Home Screen, open that app and then enable
notifications. Local HTTP uses a `mailto:` VAPID subject.

Webhook URLs are shown once on source creation/rotation. Rotation invalidates
the previous token. Deleting a source deletes its notifications. Opening detail
marks it read, preserving an existing read timestamp; individual and bulk
read/unread/delete operations remain available. Lists expose pagination and
the UI loads the full collection as requested.

## Environment and proxy

| Variable | Default | Meaning |
| --- | --- | --- |
| `LISTEN_HOST` | `localhost` (Docker: `0.0.0.0`) | Bind interface. |
| `LISTEN_PORT` | `3000` (Docker: `8080`) | HTTP port. |
| `LISTEN_DATA_DIR` | `./data` (Docker: `/app/data`) | Private persistent volume. |
| `LISTEN_PUBLIC_BASE_URL` | unset | Public origin-only HTTP(S) URL. |
| `LISTEN_LOG_LEVEL` | `info` | Server diagnostic level. |
| `LISTEN_TRUST_PROXY` | `false` (Docker: `true`) | Enable explicit forwarded-header trust. |
| `LISTEN_TRUST_PROXY_HEADERS` | `proto,host,prefix` when enabled | Trusted URL/origin headers. |
| `LISTEN_TRUST_PROXY_CHAIN` | `first` | Trusted comma-separated chain value. |
| `LISTEN_VAPID_SUBJECT` | HTTPS public origin, or local `mailto:` | Optional push subject override. |

Use the root of a dedicated domain. At a TLS-terminating proxy, set the public
origin and trust only headers the proxy strips and replaces. A health check is
available at `/api/health`; it does not grant app access.

Webhook rate limits use independent 120-request/minute direct-peer and verified
source buckets, plus an emergency process-wide 10,000-request/minute ceiling.
Idle buckets expire after five minutes; maps are bounded to 10,000 entries.
Forwarded client IPs are not trusted. Clients behind a proxy may share the peer
bucket; source buckets remain separate.
