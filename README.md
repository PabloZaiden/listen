# Listen

Listen is a passkey-protected, multi-user notification inbox for coding agents and automation tools. It runs as one `listen` binary that serves the web UI and provides CLI commands for agents to send notifications through source-specific webhook URLs.

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/pablozaiden/installer/main/install.sh | sh -s -- pablozaiden/listen
```

## Quick start

```bash
listen serve
```

Open the server in a browser, create the owner user/passkey, create a webhook source, and copy the generated URL immediately. Webhook URLs are only shown on source creation and token rotation.

## Running the server

```bash
listen serve
LISTEN_HOST=0.0.0.0 LISTEN_PORT=3000 listen serve
```

Native runs default to `localhost:3000`. Docker uses `0.0.0.0:8080` and stores data in `/app/data`.

## Browser notifications

The Settings view includes per-browser Web Push subscriptions. Click "Enable on this browser" to allow Listen to send system notifications to the current browser profile. Repeat this on each desktop or mobile browser where you want notifications. If the browser is already subscribed, Settings shows a disable action for only that browser.

The webapp framework serves Listen's PWA metadata, including `/site.webmanifest`, app icons, and the apple touch icon used by macOS Dock and iPhone Home Screen installs. Browser notifications use standards-based Web Push with a TypeScript service worker served directly at `/service-worker`. VAPID keys are generated once and persisted in the data directory. The public origin used for VAPID and webhook URLs comes from `LISTEN_PUBLIC_BASE_URL` when configured, otherwise from the direct request URL. Local `http:` development uses a `mailto:` VAPID subject because Web Push requires VAPID subjects to be `https:` or `mailto:`.

Safari support uses the modern Web Push API. On iPhone and iPad, install Listen to the Home Screen first, open it from the Home Screen web app, then subscribe from Settings. Production browser notifications require HTTPS; localhost can be used for development.

## First passkey setup

All non-public backend operations require passkey authentication unless `LISTEN_DISABLE_PASSKEY=true`, `1`, or `yes` is set for emergency recovery. Passkeys require HTTPS except on localhost.

## Creating a webhook source

Use the Sources view in the UI. Each source gets a unique long random token embedded in:

```text
https://listen.example.com/api/webhooks/source-id/token
```

## Configuring the CLI for agents

```bash
listen config set-webhook-url "https://listen.example.com/api/webhooks/source-id/token"
listen config show
listen config clear
```

Config is stored at `~/.listen/config.json`. `LISTEN_WEBHOOK_URL` overrides stored config for `listen notify`.

## Sending notifications

```bash
listen notify --title "Task completed" --description "The agent finished successfully" --markdown "The task is done."
listen notify --title "Review needed" --description "The agent needs attention" --markdown-file ./message.md
listen notify --title "Icon" --description "PNG attached" --markdown "Done." --icon-file ./icon.png
```

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

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `LISTEN_HOST` | `localhost` | Host/interface for `Bun.serve`. |
| `LISTEN_PORT` | `3000` | HTTP port, integer `0` to `65535`. |
| `LISTEN_DATA_DIR` | `./data` | Directory containing `listen.db`. |
| `LISTEN_DISABLE_PASSKEY` | unset | `true`, `1`, or `yes` bypasses passkey enforcement. |
| `LISTEN_DISABLE_SAME_ORIGIN_CHECK` | unset | `true`, `1`, or `yes` disables same-origin protection. |
| `LISTEN_LOG_LEVEL` | `info` | Server log level. |
| `LISTEN_PUBLIC_BASE_URL` | unset | Public origin used for framework and Listen-generated URLs. |
| `LISTEN_TRUST_PROXY` | `false` (Docker image: `true`) | Enables trusted forwarded request headers. |
| `LISTEN_TRUST_PROXY_HEADERS` | `proto,host,prefix` when enabled | Forwarded headers to trust. Listen deployments should normally omit `prefix`. |
| `LISTEN_TRUST_PROXY_CHAIN` | `first` | Which value to use from comma-separated forwarded header chains. |
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

Open `http://127.0.0.1:3000/`. `LISTEN_DEMO_RESET=true bun run seed:demo` clears notifications first, but source reset requires a fresh `LISTEN_DATA_DIR` because Listen only supports soft-disabling sources.

## Release artifacts

Release workflows build Linux and macOS binaries for x64 and arm64 with `.sha256` checksum assets, publish Docker images to GHCR, and support `listen update` through `@pablozaiden/installer`.

## License

See the repository license.
