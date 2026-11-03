# Development

Use Bun. `bun run dev` directly starts the web app with hot reload; no `serve`
command or client configuration is involved. `bun run build` embeds the web app,
PWA icons and typed service worker into `dist/listen`, an internal container
executable. Docker is the only supported distribution. Main/tag workflows still
build container images; no public binary-release workflow remains.

Listen owns its singleton identity, passkey/session/challenge persistence,
account policy, migration and minimal auth/Settings screens. Webapp supplies
neutral serving/realtime/frame/components and optional authentication helpers.
Do not import or duplicate the former framework account/admin/runtime stack.
The password bonus is not enabled. Persistence is explicit, including the
selected browser preferences adapter.

Private domain operations require the current `OwnerAccount`; arbitrary user
IDs or missing identity never imply global access. Public webhook ingestion
first validates the source token, then derives the owner from that source.
SQL ownership fields remain internal referential constraints, not a multi-user
product interface. One-time webhook responses use strict response schemas.

Before delivery run:

```bash
bun run build && bun run test
bun run tsc
```

PR checks retain separate required `build-and-test` and `smoke-test` jobs.
The former exercises compiled and Docker workflows; the latter verifies
development serving, assets, PWA headers and private-access enforcement.

The approved fresh single-account and legacy upgrade workflows use disposable
data, compiled server startup and real HTTP/WebSocket/WebAuthn verification.
Legacy SQL is fixture setup, not an assertion boundary. Migration assertions
cover preserved domain behavior, owner-only access, valid old webhook URLs,
restart idempotency and separate backup restoration. No real push destinations
or remote webhooks are used.

For manual UI validation use disposable Bun.WebView tooling according to the
[shared skill](../.agents/skills/webapp/SKILL.md), review desktop/mobile and
dark/light screenshots, and record concrete capture blockers. Do not commit
browser automation or screenshot artifacts.

The demo seeder requires an authenticated disposable owner session, supplied
through a private cookie file. It never bypasses authentication or creates
API keys. Use an isolated `LISTEN_DATA_DIR` and never seed a real installation.
