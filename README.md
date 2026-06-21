# Listen

Listen is a single-user, passkey-protected notification inbox for coding agents and automation tools. It runs as one `listen` binary that serves the web UI and provides CLI commands for agents to send notifications through source-specific webhook URLs.

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/pablozaiden/installer/main/install.sh | sh -s -- pablozaiden/listen
```

## Quick start

```bash
listen serve
```

Open the server in a browser, set up the first passkey, create a webhook source, and copy the generated URL immediately. Webhook URLs are only shown on source creation and token rotation.

## Running the server

```bash
listen serve
LISTEN_HOST=0.0.0.0 LISTEN_PORT=3000 listen serve
```

Native runs default to `127.0.0.1:3000`. Docker uses `0.0.0.0:8080` and stores data in `/app/data`.

## Browser notifications

The Settings view includes per-browser Web Push subscriptions. Click "Enable on this browser" to allow Listen to send system notifications to the current browser profile. Repeat this on each desktop or mobile browser where you want notifications. If the browser is already subscribed, Settings shows a disable action for only that browser.

Listen uses standards-based Web Push with a TypeScript service worker served directly at `/service-worker`. VAPID keys are generated once and persisted in the data directory. The public origin used for VAPID is derived from the same request origin logic used to generate webhook URLs. Local `http:` development uses a `mailto:` VAPID subject because Web Push requires VAPID subjects to be `https:` or `mailto:`.

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

## Reverse proxy and HTTPS/passkey notes

Listen runs at the root of its own domain and does not support subpath mounting. If TLS terminates at a reverse proxy, preserve the public host and set `X-Forwarded-Proto: https` so passkey, webhook URL generation, and Web Push VAPID origins match the browser-visible URL.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `LISTEN_HOST` | `127.0.0.1` | Host/interface for `Bun.serve`. |
| `LISTEN_PORT` | `3000` | HTTP port, integer `0` to `65535`. |
| `LISTEN_DATA_DIR` | `./data` | Directory containing `listen.db`. |
| `LISTEN_DISABLE_PASSKEY` | unset | `true`, `1`, or `yes` bypasses passkey enforcement. |
| `LISTEN_DISABLE_SAME_ORIGIN_CHECK` | unset | `true`, `1`, or `yes` disables same-origin protection. |
| `LISTEN_LOG_LEVEL` | `info` | Server log level. |
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
