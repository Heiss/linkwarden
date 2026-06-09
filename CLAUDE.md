# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Environment Setup

This project runs inside a Nix dev shell (defined in `flake.nix`). Always develop inside it:

```bash
nix develop           # enter dev shell
# or for one-off commands:
nix develop --command bash -c '<cmd>'
```

The shell provides: nodejs_22, corepack_22, chromium (for Playwright on NixOS), openssl, prisma-engines. It also sets required `PRISMA_*` env vars and enables corepack.

**Important:** `flake.nix` pins nixpkgs to a stable channel (e.g. `nixos-25.05`). The `prisma-engines` package from nixpkgs **must match the major version of the `prisma` npm package** — mismatched versions cause the shell to point `PRISMA_QUERY_ENGINE_LIBRARY` to a path that doesn't exist. When upgrading the `prisma` npm package to a new major version, also update the `nixpkgs.url` in `flake.nix` to a channel that carries the matching `prisma-engines`, then run `nix flake update` to regenerate `flake.lock`. Renovate should **not** auto-update `flake.lock` independently of the npm prisma version.

**Claude Code in the shell:** `claude-code` is an unfree package and is pulled from a separate `nixpkgs-unstable` input (not the pinned stable channel, which carries a stale version). `config.allowUnfree = true` is set on that import inside the flake, so no `NIXPKGS_ALLOW_UNFREE` env var or global nixpkgs config is needed. Because it's a Nix store install it cannot `claude update` itself — to bump it, run `nix flake update nixpkgs-unstable` (this updates only that input and leaves the prisma-pinned `nixpkgs` untouched), then commit the regenerated `flake.lock`.

**Package manager: yarn 4.12.0 (Berry)**. Never use npm or pnpm.

## Commands

```bash
# Development (run both together)
yarn concurrently:dev          # web + worker together
yarn web:dev                   # Next.js frontend only
yarn worker:dev                # background worker only

# Production
yarn web:build
yarn concurrently:start

# Database
yarn prisma:deploy             # run migrations (production)
yarn prisma:dev                # create + run new migration (dev)
yarn prisma:generate           # regenerate Prisma client
yarn prisma:studio             # open Prisma Studio

# Tests
yarn test                      # run all unit tests (vitest)
yarn test --run path/to/file   # run a single test file
yarn coverage                  # coverage report

# E2E tests (from apps/web/)
yarn workspace @linkwarden/web e2e

# Lint / Format
yarn workspace @linkwarden/web lint
yarn format                    # prettier across all workspaces

# Worker typecheck
yarn workspace @linkwarden/worker typecheck
```

All dev commands require a `.env` file at the repo root (copy from `.env.sample`). Required vars: `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `DATABASE_URL`.

## Downstream Fork Strategy

This repository is a **downstream fork** of [linkwarden/linkwarden](https://github.com/linkwarden/linkwarden). Upstream changes are merged regularly via Renovate bot processes. Every change made here must be designed to survive those merges with minimal conflicts.

### Rules for making changes

- **Prefer self-contained, additive modules over modifying existing files.** New functionality should live in new files (e.g., a new handler in `apps/worker/lib/preservationScheme/`) that are simply imported and called from the integration point. This limits upstream conflicts to a single small call-site change rather than scattered edits across a large file.
- **Duplicate code rather than refactor shared code.** If upstream logic needs to be slightly changed for a local feature, copy and modify it locally instead of altering the shared original. A merge conflict in a new file you own is trivially resolved; a conflict in a heavily modified upstream file is not.
- **Keep integration points minimal.** When wiring a new module into an existing upstream file (e.g., `archiveHandler.ts`), add the smallest possible diff — typically a single import and a short conditional call — so that upstream changes to surrounding code don't conflict.
- **Never restructure or reformat upstream files.** Whitespace, variable rename, or organizational changes to upstream files create spurious merge conflicts on every upstream update.
- **Avoid modifying `packages/` shared libraries** unless strictly necessary. Changes there affect the entire monorepo and conflict surface is high.
- **Duplicate helper functions rather than exporting/importing them across files** when the source file is upstream-owned. For example, `getAIModel()` is intentionally re-implemented inside `handleYoutubeTranscript.ts` rather than imported from `autoTagLink.ts` — this keeps both files independently mergeable.

### Database migrations

Prisma applies migrations in timestamp order. Upstream continuously adds new migration files. Any local migration file committed with a fixed timestamp can end up out-of-order or conflict with an upstream migration that touches the same table — causing drift errors on the next merge.

**The rule: never commit local migration files. Only commit `schema.prisma` changes.**

Workflow for a local schema change:
1. Edit `packages/prisma/schema.prisma` with the new field/model (additive only — no drops or renames of upstream-owned columns).
2. Run `yarn prisma:generate` so the Prisma client reflects the new schema locally.
3. Commit only the `schema.prisma` change. Do not commit any generated migration file.

When merging upstream and deploying:
1. Merge upstream (brings in their new migration files and any schema updates).
2. Re-apply local `schema.prisma` additions on top if there were conflicts.
3. Run `yarn prisma:dev --name <feature_name>` to generate a fresh migration file with the correct current timestamp, appended after all upstream migrations.
4. Commit the newly generated migration file.

This ensures local schema changes are always stamped with a timestamp that comes after whatever upstream has at the time of the merge, and the migration history stays clean.

A CI workflow (`.github/workflows/migration-drift.yml`) enforces this: it runs `prisma migrate diff --from-migrations --to-schema-datamodel --exit-code` on every PR and fails if `schema.prisma` has fields not covered by the committed migration files. This is the automated reminder — a PR with uncommitted schema changes will be blocked until the migration is generated and committed.

## Architecture

Linkwarden is a self-hosted bookmark manager that archives webpages (screenshot, PDF, monolith HTML, readable text). It's a **yarn Berry monorepo** with these workspaces:

### Apps
- **`apps/web`** — Next.js 15 frontend + API (`@linkwarden/web`). Uses Pages Router. API routes live under `pages/api/v1/`. Auth via NextAuth.
- **`apps/worker`** — Long-running background process (`@linkwarden/worker`). Polls the web API for queued archival jobs and processes them using Playwright.
- **`apps/mobile`** — React Native / Expo mobile app (separate node_modules).

### Packages
- **`packages/prisma`** — Prisma schema + client. Schema at `packages/prisma/schema.prisma`. Import as `@linkwarden/prisma`.
- **`packages/types`** — Shared TypeScript types (`global.ts`). Import as `@linkwarden/types`.
- **`packages/lib`** — Shared utilities (SSRF protection, archival tag helpers, etc.). Import as `@linkwarden/lib`.
- **`packages/filesystem`** — File read/write helpers for the archive storage layer. Import as `@linkwarden/filesystem`.
- **`packages/router`** — Shared routing utilities. Import as `@linkwarden/router`.

### Archival Pipeline (worker)

The core archival flow lives in `apps/worker/lib/archiveHandler.ts`:

1. Fetch headers to determine link type (image, PDF, or webpage)
2. For YouTube URLs: fetch transcript via `handleYoutubeTranscript.ts` (skips screenshot/PDF/monolith). If the user has `youtubeDescriptionEnabled`, an LLM generates a description from the transcript using `youtubeDescriptionSystemPrompt` (falls back to a hardcoded default). Description is stored in `link.metaDescription` and `article.excerpt` in the readability JSON.
3. For images: `imageHandler.ts`; for PDFs: `pdfHandler.ts`
4. For webpages: launch a Playwright browser context, navigate to the URL, then run:
   - `handleMonolith.ts` — saves single-file HTML
   - `handleReadability.ts` — extracts readable text via `@mozilla/readability`
   - `handleScreenshotAndPdf.ts` — captures screenshot + PDF
   - `handleArchivePreview.ts` — generates a preview image
5. Optionally sends to Wayback Machine (`sendToWayback.ts`)
6. Optionally AI-tags the link using the Vercel AI SDK (supports Anthropic, OpenAI-compatible, Azure, OpenRouter, Perplexity, Ollama)
7. Background worker `autoDescribeYoutubeLinks.ts` processes already-archived YouTube links where `youtubeDescribed = false` and the owner has `youtubeDescriptionEnabled = true`

Archival settings can be overridden per-link via **archival tags** (special tags with `archiveAs*` flags stored in the DB).

### Web API Pattern

API routes delegate immediately to controller functions in `apps/web/lib/api/controllers/`. Authentication is checked via `verifyUser()` or `verifyToken()` before any controller logic runs. Permission checks use `getPermission()`.

### Frontend State

- **Zustand** store in `apps/web/store/` for client-side link/settings state.
- **TanStack Query** for server state / data fetching.
- UI components use **Tailwind CSS** + **DaisyUI** + **Radix UI** primitives.
- i18n via `next-i18next` / `react-i18next`.

### Preservation UI

`apps/web/components/Preservation/` renders archived content:
- `PreservationContent.tsx` — format switcher (readable / monolith / PDF / screenshot)
- `ReadableView.tsx` — reader view with text highlights, font settings, and YouTube embed support
- `PreservationNavbar.tsx` — top nav with format dropdown
- `PreservationPageContent.tsx` — scroll container

### Database

PostgreSQL via Prisma. Key models: `User`, `Collection`, `Link`, `Tag`, `Highlight`, `AccessToken`, `Subscription`. The `Link` model stores archival status fields (`readable`, `image`, `monolith`, `pdf`, `preview`) as strings — `"pending"`, `"unavailable"`, or the file path.

### Storage

Archives are stored locally under `STORAGE_FOLDER` (default: `data/`) or in S3-compatible storage (configured via `SPACES_*` env vars). The `@linkwarden/filesystem` package abstracts read/write.

### Testing

Unit tests (`.test.ts` files) use **vitest** and are colocated with source files. The vitest config at the root resolves `@` as `apps/web`. E2E tests use **Playwright** and live in `apps/web/e2e/`.
