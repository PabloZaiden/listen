# Listen

Listen is a multi-user notification inbox for coding agents and automation tools. Its web UI uses the Webapp framework's passkey, API-key, and device authentication, and it runs as one `listen` binary that serves the web UI and provides CLI commands for agents to send notifications through source-specific webhook URLs.

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/pablozaiden/installer/main/install.sh | sh -s -- pablozaiden/listen
```

## Quick start

```bash
listen serve
```

Open the server in a browser, complete the owner user/passkey setup, create a webhook source, and copy the generated URL immediately. Webhook URLs are only shown on source creation and token rotation.

## Running the server

```bash
listen serve
LISTEN_HOST=0.0.0.0 LISTEN_PORT=3000 listen serve
```

Native runs default to `localhost:3000`. Docker uses `0.0.0.0:8080` and stores data in `/app/data`.

Successful server-start lifecycle messages are owned by the Webapp framework,
which reports the bound server URL. Listen does not duplicate that event;
application logs are reserved for distinct, safe diagnostics. Never log
webhook tokens, complete webhook URLs, authentication material, or other
credentials.

## CLI command routing

Listen composes its command-line interface with `createWebAppCli()` from
`@pablozaiden/webapp`. The framework owns `help`, `serve`, `version`, `update`,
`logs`, `api`, `schema`, `auth`, `status`, `profile`, and `ws`. Listen keeps
only its domain commands: `config` (an explicit override for webhook
configuration) and `notify`.

Use `listen update [--check] [--version <version>]` for installer-backed release
checks and updates.

## Browser notifications

The Settings view includes per-browser Web Push subscriptions. Click "Enable on this browser" to allow Listen to send system notifications to the current browser profile. Repeat this on each desktop or mobile browser where you want notifications. If the browser is already subscribed, Settings shows an unsubscribe action for only that browser.

The webapp framework serves Listen's PWA metadata, including `/site.webmanifest`, app icons, and the apple touch icon used by macOS Dock and iPhone Home Screen installs. Browser notifications use standards-based Web Push with a Listen-owned TypeScript service worker compiled and served as a framework-managed public asset at `/service-worker`. VAPID keys are generated once and persisted in the data directory. The public origin used for VAPID and the public request base used for webhook URLs are resolved by the webapp framework from `LISTEN_PUBLIC_BASE_URL` or the direct/trusted-proxy request context. Local `http:` development uses a `mailto:` VAPID subject because Web Push requires VAPID subjects to be `https:` or `mailto:`.

Safari support uses the modern Web Push API. On iPhone and iPad, install Listen to the Home Screen first, open it from the Home Screen web app, then subscribe from Settings. Production browser notifications require HTTPS; localhost can be used for development.

## First passkey setup

All protected backend operations use Webapp framework authentication. Listen
enables passkeys, API keys, and device authentication; the initial browser
setup creates the owner user and passkey. Set `LISTEN_DISABLE_PASSKEY=true`,
`1`, or `yes` only for emergency recovery or disposable local development.
Passkeys require HTTPS except on localhost.

## Creating a webhook source

Use the Sources view in the UI. Each source gets a unique long random token embedded in:

```text
https://listen.example.com/api/webhooks/source-id/token
```

Deleting a source permanently removes the source and its notifications. Create a new source if a replacement webhook URL is needed.

## Configuring the CLI for agents

```bash
listen config set-webhook-url "https://listen.example.com/api/webhooks/source-id/token"
listen config show
listen config clear
```

`listen config set-webhook-url` writes `~/.listen/config.json`. An optional
`listen.config.json` beside the binary is read first, and
`LISTEN_WEBHOOK_URL` overrides both for `listen notify`. `listen config clear`
removes the home config file; it does not remove a sidecar config.

## Sending notifications

```bash
listen notify --title "Task completed" --description "The agent finished successfully" --markdown "The task is done."
listen notify --title "Review needed" --description "The agent needs attention" --markdown-file ./message.md
listen notify --title "Icon" --description "PNG attached" --markdown "Done." --icon-file ./icon.png
```

## Notification read state

Listen uses `read` and `unread` for notification state transitions. Fetching
`GET /api/notifications/:id` marks an unread notification read the first time;
repeated detail fetches do not change its state or the unread count. Use
`POST /api/notifications/read` for bulk reads and
`POST /api/notifications/:id/read` or
`POST /api/notifications/:id/unread` for individual changes.

Notification responses expose the read timestamp as `readAt`. Use
`read=true|false` as the list and delete read-state filter.

## Database compatibility

Listen initializes the current database schema directly and does not migrate
database files from older versions. Older data directories are unsupported;
use a fresh data directory or handle any data transfer out of band before
starting the current release.

## Docker deployment

```yaml
services:
  listen:
    image: ghcr.io/pablozaiden/listen:latest
    ports:
      - "8080:8080"
    volumes:
      - listen-data:/app/data
    environment:
      LISTEN_DATA_DIR: /app/data

volumes:
  listen-data:
```

The Docker image trusts the first proxy hop by default and uses `proto`, `host`,
and `prefix` forwarded headers. Override these `LISTEN_TRUST_PROXY*` variables
when the container is not behind a proxy or the deployment requires different
forwarded-header handling.

## Reverse proxy and HTTPS/passkey notes

Listen runs at the root of its own domain and does not support subpath mounting. If TLS terminates at a reverse proxy, configure the framework's explicit proxy trust settings and public origin:

```bash
LISTEN_PUBLIC_BASE_URL=https://listen.example.com
LISTEN_TRUST_PROXY=true
LISTEN_TRUST_PROXY_HEADERS=proto,host
LISTEN_TRUST_PROXY_CHAIN=first
```

The proxy must strip client-supplied forwarded headers before setting the trusted values. `LISTEN_PUBLIC_BASE_URL` keeps passkey, webhook URL generation, and Web Push VAPID origins aligned with the browser-visible URL.

## Webhook rate limiting and deployment

Webhook ingestion uses independent 120-request-per-minute windows for the direct caller peer and each validated source. Caller and source buckets expire after five minutes and each in-memory map is capped at 10,000 entries. A separate 10,000-request-per-minute process-wide ceiling applies after the caller check and before source lookup/token validation; it is an emergency safety valve, not the normal isolation mechanism.

The limiter uses Bun's direct request peer address. The current framework trust-proxy configuration supports forwarded protocol, host, and prefix values for URL/origin handling, but does not make a forwarded client address trustworthy; Listen therefore does not parse `X-Forwarded-For` for rate-limit identity. Clients behind the same reverse proxy may share the caller bucket, while source-token buckets remain independent. Proxies must strip client-supplied forwarded headers before setting any trusted values.

Limiter state is local to one process. Deployments with multiple Listen processes or replicas need shared rate-limit storage or equivalent coordination if limits must apply across all instances.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `LISTEN_HOST` | `localhost` | Host/interface for `Bun.serve`. |
| `LISTEN_PORT` | `3000` | HTTP port, integer `0` to `65535`. |
| `LISTEN_DATA_DIR` | `./data` | Directory containing `listen.db`. |
| `LISTEN_DISABLE_PASSKEY` | unset | `true`, `1`, or `yes` bypasses passkey enforcement. |
| `LISTEN_DISABLE_SAME_ORIGIN_CHECK` | unset | `true`, `1`, or `yes` disables same-origin protection. |
| `LISTEN_AUTH_ISSUER` | unset | Issuer for framework device-auth tokens; defaults to `urn:listen:webapp`. |
| `LISTEN_IN_MEMORY_LOGS` | `false` | Enables framework in-memory server log storage. |
| `LISTEN_LOG_LEVEL` | `info` | Server log level. |
| `LISTEN_PUBLIC_BASE_URL` | unset | Origin-only absolute `http` or `https` URL used for framework and Listen-generated URLs. |
| `LISTEN_TRUST_PROXY` | `false` (Docker image: `true`) | Enables trusted forwarded request headers. |
| `LISTEN_TRUST_PROXY_HEADERS` | `proto,host,prefix` when enabled | Forwarded headers to trust; `prefix` is included in generated public webhook URLs when configured. |
| `LISTEN_TRUST_PROXY_CHAIN` | `first` | Which value to use from comma-separated forwarded header chains. |
| `LISTEN_VAPID_SUBJECT` | unset | Browser-push VAPID subject; when unset, uses the HTTPS public origin or `mailto:listen@example.com` for non-HTTPS origins. |
| `LISTEN_WEBHOOK_URL` | unset | CLI webhook override for `listen notify`. |

## Development

```bash
bun install
bun run dev
bun run build
bun run test
```

### Demo data for UI development

Use a temporary data directory for visual testing so generated webhook URLs stay local and disposable:

```bash
LISTEN_DATA_DIR="$(mktemp -d)" LISTEN_DISABLE_PASSKEY=true bun run dev
```

In another terminal, seed realistic sources and notifications through the public app APIs and source-specific webhook URLs:

```bash
bun run seed:demo
```

The seeder uses `LISTEN_BASE_URL=http://127.0.0.1:3000` by default; set it
when the server uses another URL. `LISTEN_DEMO_SOURCE_COUNT` and
`LISTEN_DEMO_NOTIFICATION_COUNT` default to `4` and `30`. Use
`LISTEN_DEMO_RESET=true bun run seed:demo` to clear notifications first while
leaving sources in place; use a fresh `LISTEN_DATA_DIR` for a fully clean demo
dataset. Open `http://127.0.0.1:3000/` after starting the server.

## Release artifacts

Release workflows build Linux and macOS binaries for x64 and arm64 with `.sha256` checksum assets, publish Docker images to GHCR, and support `listen update` through `@pablozaiden/installer`.
