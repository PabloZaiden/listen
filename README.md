# Listen

A single-user, passkey-protected notification inbox for agents and webhooks.
Listen serves its React web app and PWA from a Bun server and is distributed
only as a Docker image. There is no client CLI, API-key login or device auth.

## Run

```yaml
services:
  listen:
    image: ghcr.io/pablozaiden/listen:latest
    ports:
      - "8080:8080"
    volumes:
      - listen-data:/app/data
    environment:
      LISTEN_PUBLIC_BASE_URL: https://listen.example.com

volumes:
  listen-data:
```

Open the app, enroll the sole owner's passkey, then create a source. Copy its
webhook URL immediately: it is shown only on creation and token rotation.
Passkeys and production browser push require HTTPS; localhost supports development.
Settings contains passkey replacement, logout, theme, browser push and version.

Send a JSON `POST` to the source URL with `title`, `shortDescription` and
`markdownContent`. Keep that URL private; its token authorizes webhook delivery.
The source name comes from the saved source, never the payload.

Existing supported multi-user volumes migrate automatically after a private
backup. **Read [upgrade and restore](docs/operations.md#upgrade-and-restore)
before upgrading.** Older binaries must not run against migrated volumes.

## Development

```bash
bun install
LISTEN_DATA_DIR=./.cache/dev-data bun run dev
bun run build && bun run test
bun run tsc
```

Development uses Bun hot reload; the build embeds web assets and the service
worker in the container's internal executable. Do not use real accounts,
push credentials or webhooks for tests.

See [operations](docs/operations.md), [development](docs/development.md) and
[live synchronization](docs/realtime.md).
