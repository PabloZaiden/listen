# Agent Guidelines for Listen

## General Agentic Workflow

Use Bun only. Run `bun install` before development when dependencies are missing. Run `bun run build` before tests, and run `bun run build && bun run test` before calling work complete.

## Project Overview

Listen is a single-user web notification inbox for coding agents. It has a Bun backend, React browser UI, application-owned SQLite/passkey/session persistence, source-specific public webhook ingestion and framework realtime. Docker is the only distribution; its executable is internal, not a client CLI. Start with [development](docs/development.md) and consult [operations](docs/operations.md) for migration/restore.

## Authentication and Security

All protected app APIs and realtime require the sole Listen owner. Listen explicitly composes optional Webapp passkey/session helpers; core has no account policy. The token-validated webhook is the only unauthenticated domain write. Bootstrap/login ceremonies are separately bounded auth endpoints. Never log webhook tokens, passkey material, cookies, auth headers or raw credentials. Never store raw webhook tokens. Never trust `source` from webhook payloads.
Return each secret only in the minimum representation required by the caller; do not expose redundant raw credential fields.
Define response schemas for endpoints that return one-time credentials and serialize only those schemas.
Never log webhook tokens, complete webhook URLs, or other raw credentials.

Private core/persistence operations require a current `OwnerAccount`. Missing/stale identity or arbitrary IDs never imply global access. The singleton owner is real app-owned state; do not introduce roles, invitations, user lists, API keys or device auth. Keep row types aligned with non-null ownership constraints. Public webhook authority comes only from the validated saved source. Never log browser push endpoints, keys or subscription credentials.

Public endpoint rate limits must isolate independent callers and tenants; attacker-controlled invalid traffic must not consume another user's primary allowance. In-memory limiter maps must expire inactive entries and enforce a hard size bound. Forwarded client identity may only be used through explicitly configured trusted-proxy behavior.

## TypeScript

Keep strict types. Prefer shared contracts from `packages/contracts`, shared limits from `packages/shared`, and framework helpers from `@pablozaiden/webapp`. Use bracket notation for environment variables. All source code must be TypeScript; do not add JavaScript source files. Bun serves and executes TypeScript directly, including browser-facing entrypoints such as service workers.
Use direct Bun startup, not framework CLI/config/updater modules.
Do not mutate returned framework configuration or internal objects to simulate constructor options. When a required framework extension point is missing, add it upstream and consume its public API through a GitHub commit or tag rather than depending on object identity or initialization order. Test-only option types must describe exactly the overrides the helper supports.
Use the supported Webapp request-body parsers and public-asset APIs instead of
reconstructing `Request` objects, importing TypeScript as raw text, concatenating
source, or transpiling browser assets at runtime. If a generally useful
integration seam is missing, implement it upstream and consume a pinned GitHub
commit or tag rather than adding a Listen-specific bypass. Intermediate
releases are not required; update package.json and bun.lock together.

## Naming Conventions

Use clear English names for code, comments, API messages, documentation, and release metadata.
Choose one domain term for each state and use it consistently across routes, core functions, persistence, events, and UI.
Do not add alias routes or duplicate mutation functions without a documented compatibility requirement and removal plan.
State-transition events must describe the resulting state accurately.

## Error Handling

Never fail silently. Do not leave empty catch blocks. Surface structured API errors with stable machine-readable error codes. Avoid duplicate logging across layers.
Promises started by UI event handlers must have explicit success and failure paths; do not discard a rejecting mutation promise.
Use the framework `useToast()` for transient mutation success and failure feedback. Keep inline errors for persistent form or page state and do not add app-owned toast infrastructure.

## Async Patterns

Use `async`/`await` for I/O. Keep event delivery synchronous and best-effort; a listener failure must not prevent delivery to other listeners.
Disable or guard mutation controls while their requests are active, especially destructive confirmation actions, so repeated activation cannot submit duplicates.
After a successful mutation, reconcile the initiating client from the response or an explicit local refresh; do not depend solely on realtime delivery for the current client.

## React Components

Prefer small components and hooks. Components over 300 LOC should be decomposed. Use AbortController in effects that load data. UI changes should be manually checked on desktop and mobile when possible. For UI-specific changes and fixes, capture screenshots of the affected states and inspect them before calling the work complete when feasible.
Keep browser entrypoints small: route views, domain data hooks, and substantial interaction logic belong in focused modules rather than the entrypoint.
Components over 300 lines must be decomposed unless the code review documents a concrete reason to keep them together.

## Comments

Only comment code that needs clarification. Do not add obvious comments.

## Formatting

Follow the surrounding TypeScript style. Keep code readable and avoid unrelated rewrites.

## API Routes

App routes should be declared in `src/server.ts` with `defineRoutes` and delegate mutations to core managers. Route handlers must not import persistence modules directly. Persistence must use parameterized SQL. Validate request bodies, query parameters, and reusable route inputs through shared schemas from `packages/contracts` when a schema exists. Do not duplicate limits, defaults, coercion, or validation rules in route handlers. Invalid external input must return a structured error instead of being silently replaced with a valid default.

## Bun Specifics

Use Bun APIs and scripts. Do not add Node-only tooling. Use `bun:sqlite` for SQLite and `@pablozaiden/webapp` for HTTP/realtime serving.
Service-worker push, notification, click-navigation, and app-badge behavior
remain Listen-owned. Define the worker as a typed Webapp public asset and use
the same asset metadata for development serving and embedded container builds.

## Persistence

Use database constraints and foreign-key cascades as the single source of
referential behavior; do not duplicate cascade deletes in application code.
Run multi-step persistence mutations that must succeed together inside a
database transaction.
Every persisted state and public contract field must have a reachable write
path and documented product meaning. Remove dead compatibility fields and
infrastructure when they have no supported consumer.

Application state delivery uses framework realtime as the single event system.
Do not add or maintain a parallel app-owned event emitter.
When a domain hook owns an owner-scoped live collection, use framework
`useLiveQuery` for its subscription, activation/reconnect snapshots,
cancellation and mutation reconciliation. Route views must not subscribe to
the same resource a second time. Keep the notification owner mounted in
`ListenApp` so inbox, detail and header mutations share its mutation barrier.
Use query dependencies for route filters and authoritative loaded-prefix
snapshots for paginated recovery; keep unread counts inbox-wide.

## Testing

Use `bun test` through repository scripts. Prefer API/integration tests over brittle frontend component tests. Do not add frontend tests that only reimplement or assert static component markup; cover behavior, data flow, contracts, or integration seams instead. Do not add browser automation tests; use `Bun.WebView` only for manual UI validation when needed.
Refactors must not add tests that merely assert component, file, or module structure.
Test externally required atomic behavior rather than duplicating direct schema
operations in application-level tests.
Tests must focus on behavior, public contracts, security boundaries, and
meaningful integration seams. Do not duplicate framework-owned endpoint tests in
Listen beyond the minimum application route-wiring check.
Do not test exact UI copy, CSS classes, DOM structure, logger messages or
levels, removed behavior, absent legacy schema, or private SQL choices.
Prefer one broad state-transition or integration scenario over many
micro-regression tests for constants and historical fixes. If an
implementation-level test is retained, document the concrete contract or
security invariant it protects.

## Database Migrations

Keep the fresh schema in `src/persistence/schema.ts`. Sequential idempotent migrations belong in `src/persistence/migrations`; the approved singleton upgrade must back up before mutation, merge all domain data, retain only owner access, invalidate old sessions/links/machine credentials, and commit its marker atomically.
Migrations must preserve supported data and ownership constraints, handle
existing databases safely, and never restore removed legacy migrations as part
of fresh-database initialization.

## Security Anti-Patterns to Avoid

Do not use `INSERT OR REPLACE`. Do not interpolate untrusted values into SQL. Use safe JSON parsing for persisted JSON. Do not enable raw HTML Markdown rendering. Do not allow non-PNG icon data URLs.

## Common Patterns

Use Route -> Core -> Persistence imports and shared zod validation. Use the framework shell/settings/title-bar action menu/realtime primitives; Listen owns its auth gate and minimal account screens. Only passkey, logout, theme, push and version belong in Settings. Browser entrypoints should compose focused route modules, domain hooks and interaction components. Route components rendered by `WebAppRoot.routes` use `Page` as the top-level wrapper; never render directly into `.wapp-main-content` or duplicate the fixed title. Define route actions once on their sidebar node; use `header.getActions` only for routes without an owning node or additional actions. Framework dialogs own Enter/Escape, red/last destructive actions and compact sidebar status dots. Keep header actions visible while titles truncate.

Webapp owns document/root viewport sizing, shell overflow, safe-area spacing,
and dynamic viewport tokens such as `--wapp-viewport-height`. Listen CSS must
not redefine global `html`, `body`, or `#root` sizing/overflow or duplicate
`100vh`/`100dvh` shell behavior. Keep product-specific layout rules scoped to
the owning Listen component, and use the framework shell and `Page` layouts
for viewport-sized content.

## Pagination and Realtime Collections

- When an API returns pagination metadata, every consuming UI must either expose the complete paginated dataset or document an intentional product limit.
- Do not hard-code the first page and ignore `nextOffset`, cursors, or equivalent continuation metadata.
- Realtime refresh logic for paginated collections must define deduplication, ordering, and preservation of already loaded pages.
