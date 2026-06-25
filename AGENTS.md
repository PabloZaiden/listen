# Agent Guidelines for Listen

## General Agentic Workflow

Use Bun only. Run `bun install` before development when dependencies are missing. Run `bun run build` before tests, and run `bun run build && bun run test` before calling work complete.

## Project Overview

Listen is a multi-user notification inbox for coding agents. It has a Bun backend, React browser UI, SQLite persistence, framework passkey/API-key/device authentication, source-specific public webhook ingestion, framework realtime updates, and a single `listen` CLI/server binary.

## Authentication and Security

All protected app APIs must use framework auth. The webhook endpoint is the only app-owned unauthenticated write endpoint. Never log webhook tokens, passkey material, cookies, auth headers, bearer tokens, API keys, or raw credentials. Never store raw webhook tokens. Never trust `source` from webhook payloads.

## TypeScript

Keep strict types. Prefer shared contracts from `packages/contracts`, shared limits from `packages/shared`, and framework helpers from `@pablozaiden/webapp`. Use bracket notation for environment variables. All source code must be TypeScript; do not add JavaScript source files. Bun serves and executes TypeScript directly, including browser-facing entrypoints such as service workers.

## Naming Conventions

Use clear English names for code, comments, API messages, documentation, and release metadata.

## Error Handling

Never fail silently. Do not leave empty catch blocks. Surface structured API errors with stable machine-readable error codes. Avoid duplicate logging across layers.

## Async Patterns

Use `async`/`await` for I/O. Keep event delivery synchronous and best-effort; a listener failure must not prevent delivery to other listeners.

## React Components

Prefer small components and hooks. Components over 300 LOC should be decomposed. Use AbortController in effects that load data. UI changes should be manually checked on desktop and mobile when possible. For UI-specific changes and fixes, capture screenshots of the affected states and inspect them before calling the work complete when feasible.

## Comments

Only comment code that needs clarification. Do not add obvious comments.

## Formatting

Follow the surrounding TypeScript style. Keep code readable and avoid unrelated rewrites.

## API Routes

App routes should be declared in `src/server.ts` with `defineRoutes` and delegate mutations to core managers. Route handlers must not import persistence modules directly. Persistence must use parameterized SQL.

## Bun Specifics

Use Bun APIs and scripts. Do not add Node-only tooling. Use `bun:sqlite` for SQLite and `@pablozaiden/webapp` for HTTP/realtime serving.

## Testing

Use `bun test` through repository scripts. Prefer API/integration tests over brittle frontend component tests. Do not add frontend tests that only reimplement or assert static component markup; cover behavior, data flow, contracts, or integration seams instead. Do not add Playwright tests; use Playwright only for manual UI validation when needed.

## Database Migrations

Keep the base schema in `src/persistence/database.ts` for initial release. Future schema changes must use sequential idempotent migrations in `src/persistence/migrations`.

## Security Anti-Patterns to Avoid

Do not use `INSERT OR REPLACE`. Do not interpolate untrusted values into SQL. Use safe JSON parsing for persisted JSON. Do not enable raw HTML Markdown rendering. Do not allow non-PNG icon data URLs.

## Common Patterns

Use Route -> Core -> Persistence imports. Use shared zod schemas for validation. Use `@pablozaiden/installer` for update behavior. Use the framework shell/settings/title-bar action menu/realtime/auth primitives instead of rebuilding them in Listen. Route components rendered by `WebAppRoot.routes` must use `Page` as the top-level wrapper, and app code must not render directly into `.wapp-main-content` or duplicate the fixed framework title with an app-local heading. Route-backed entity actions should live on `SidebarNode.actions`; use `WebAppRoot.header.getActions` only for actions that are not owned by an active sidebar node. Framework dialogs handle Enter/Escape, destructive/delete actions are red and last, sidebar badges are compact status dots, and header action buttons must stay visible while titles/subtitles truncate. When in doubt, inspect `github.com/pablozaiden/clanky` and follow the closest pattern unless a current Listen requirement differs.
