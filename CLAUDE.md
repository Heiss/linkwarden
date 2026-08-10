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

This repository is a **downstream fork** of [linkwarden/linkwarden](https://github.com/linkwarden/linkwarden). It tracks upstream **releases**, not upstream's `dev` tip, and the fork's own commits are **rebased on top** of the release it tracks. So `dev` is always exactly:

```
<upstream release tag>  +  the fork's commits
```

Every change made here must be designed to survive those rebases with minimal conflicts.

### Rules for making changes

- **Prefer self-contained, additive modules over modifying existing files.** New functionality should live in new files (e.g., a new handler in `apps/worker/lib/preservationScheme/`) that are simply imported and called from the integration point. This limits upstream conflicts to a single small call-site change rather than scattered edits across a large file.
- **Duplicate code rather than refactor shared code.** If upstream logic needs to be slightly changed for a local feature, copy and modify it locally instead of altering the shared original. A merge conflict in a new file you own is trivially resolved; a conflict in a heavily modified upstream file is not.
- **Keep integration points minimal.** When wiring a new module into an existing upstream file (e.g., `archiveHandler.ts`), add the smallest possible diff — typically a single import and a short conditional call — so that upstream changes to surrounding code don't conflict.
- **Never restructure or reformat upstream files.** Whitespace, variable rename, or organizational changes to upstream files create spurious merge conflicts on every upstream update.
- **Avoid modifying `packages/` shared libraries** unless strictly necessary. Changes there affect the entire monorepo and conflict surface is high.
- **Duplicate helper functions rather than exporting/importing them across files** when the source file is upstream-owned. For example, `getAIModel()` is intentionally re-implemented inside `handleYoutubeTranscript.ts` rather than imported from `autoTagLink.ts` — this keeps both files independently mergeable.

### Fork-owned modules (safe to edit freely)

These files exist only in this fork and carry the substance of local features; the upstream files that call them carry only one-line imports/calls:

- `apps/worker/lib/preservationScheme/handleYoutubeTranscript.ts` — transcript archival + `preArchiveYoutube()` (the single call site in `archiveHandler.ts`)
- `apps/worker/workers/autoDescribeYoutubeLinks.ts` — background description worker
- `apps/web/components/Preservation/YoutubeTranscriptPlayer.tsx` — inline player hook + component used by `ReadableView.tsx`
- `apps/web/lib/client/prepareReaderAnchors.ts` — reader-view link `target="_blank"` fix used by `ReadableView.tsx`
- `apps/web/components/YoutubeDescriptionSettings.tsx` — settings hook + UI used by `pages/settings/preference.tsx`
- `apps/web/lib/api/youtubeDescription.ts` — user-update fields + `youtubeDescribed` reset used by `updateUserById.ts`
- `packages/lib/youtubeDescriptionSchema.ts` — zod fields spread into `UpdateUserSchema`

### Enforcement: fork footprint check

The rules above are enforced mechanically — they don't rely on anyone remembering them:

- `.github/fork-footprint-budget.tsv` declares every upstream-owned file the fork modifies, with a maximum added/deleted line count vs the tracked upstream release.
- `scripts/check-fork-footprint.sh` (CI: `.github/workflows/fork-footprint.yml`, runs on every PR) fails when an upstream-owned file is modified without a budget entry or beyond its budget. Files that exist only in the fork are never checked.
- To run it locally (diffs the working tree, so it catches uncommitted mistakes): `bash scripts/check-fork-footprint.sh`

Consequences in practice:

- Running `prisma format` on `schema.prisma` re-aligns upstream lines and shows up as deletions — `schema.prisma` is budgeted with **0 deletions**, so CI blocks it. Don't raise that budget; revert the re-alignment instead.
- A new inline edit to an upstream file fails CI until it is either moved into a fork-owned module (preferred) or its budget entry is added/raised in the same PR — making every increase in conflict surface an explicit, reviewed decision.
- Lockfiles (`yarn.lock`, `flake.lock`) are exempt: they're machine-generated and merge conflicts there are resolved by regenerating.

### Upstream syncs: release-tracking + rebase

The fork never follows upstream's `dev`. Following a moving tip means constantly chasing half-finished migrations; a release is a unit upstream considers tested.

- **`.github/upstream-release`** records which upstream release the fork currently sits on (e.g. `v2.16.0`). It is the single source of truth for the sync bot, the fork-footprint check and the release version. `scripts/sync-upstream-rebase.sh` updates it as part of the rebase — don't hand-edit it except to deliberately move to a different release.
- **Upstream tags live in their own ref namespace, `refs/upstream/tags/*`.** The fork publishes releases under the *same* version numbers as upstream (see below), so upstream's tags must not land in `refs/tags/*`. The dev shell configures the `upstream` remote for this; `scripts/upstream-release.sh` provides the shared helpers (`fetch_upstream_tags`, `current_upstream_release`, `latest_upstream_release`).
- **The daily sync workflow** (`.github/workflows/sync-upstream.yml`) compares the recorded release against the highest stable upstream tag (pre-releases like `-rc.1` are ignored). If a newer one exists it runs `scripts/sync-upstream-rebase.sh`, which rebases the fork's commits onto the new tag with rerere replaying known conflicts, then bumps `.github/upstream-release`.
- The rebased history is force-pushed to the bot branch `sync-upstream-release` and opened as a PR. Checks (fork-footprint, migration-drift, Playwright) are dispatched explicitly — pushes made with the Actions token don't trigger workflows on their own. A later run of the workflow **force-pushes that history onto `dev`** once all of them are green, and then triggers a release.
- The force-push is guarded by `--force-with-lease` against the exact `dev` commit the rebase was built from (recorded in the PR body). **Pushing your own work to `dev` always wins** — it just makes the bot branch stale, and the next run rebuilds it.
- If rerere can't resolve everything, the workflow opens an issue listing the unresolved files, with the commands to resolve it once locally. Nothing is pushed.

To move the fork onto a specific release by hand (e.g. to skip ahead, or after resolving conflicts):

```bash
git checkout dev
bash scripts/sync-upstream-rebase.sh v2.17.0   # stops on unknown conflicts
# ...resolve, git add, git rebase --continue...
bash scripts/rerere-cache.sh save              # make the resolution committable
git add .rr-cache .github/upstream-release && git commit
git push --force-with-lease origin dev
```

Conflicts with upstream only ever need to be resolved by a human **once**. `git rerere` records each resolution; `.rr-cache/` is the tracked, shared copy of that cache. The dev shell seeds git's live cache from it on shell entry, and `scripts/rerere-cache.sh save` copies newly recorded resolutions back so they can be committed. (It's a copy, not a symlink: the sync rebase replays fork commits whose trees predate `.rr-cache/`, which makes a symlink dangle mid-rebase and aborts the rebase.)

### Releases and versioning

- **The fork releases under the same version number as the upstream release it is built on.** "Upstream v2.16.0 + our commits" ships as `v2.16.0`. The fork publishes from its own registry (`ghcr.io/heiss/linkwarden`), so there is nothing to disambiguate against, and the tag immediately says which tested upstream release is inside.
- A second release on the *same* upstream base — a fork-only fix, no upstream bump — appends a fourth component: `v2.16.0.1`, `v2.16.0.2`, …
- `.github/workflows/release.yml` cuts a release: it mirrors `dev` onto `main` (force-push — `dev` is rebased, so `main` is a mirror, not a merge target), computes the next tag from `.github/upstream-release`, and pushes it with a PAT so the container build actually triggers. It runs automatically after the sync bot lands a new upstream release, and manually (`workflow_dispatch`) for fork-only releases.
- `.github/workflows/release-container.yml` publishes, per release, the exact tag plus the floating tags that make deployment simple:

  | image tag | points at |
  | --- | --- |
  | `2.16.0.1` | that exact build |
  | `2.16.0` | newest fork build on upstream 2.16.0 |
  | `2.16` | newest patch within 2.16 |
  | `latest` | newest release overall |

  A float is only published when the tag really is the newest in its bucket, so rebuilding an old tag can never move `latest` backwards.
- Past release tags keep pointing at the exact commits their images were built from, even though `dev` and `main` are force-pushed.

### Database migrations

Prisma applies migrations in filename (timestamp) order, and upstream keeps adding new ones. Because the fork rebases onto upstream releases, a fork migration created today can end up sorting *before* upstream migrations that arrive later.

**Fork migrations must be purely additive** — new columns/models only, no drops or renames of upstream-owned columns. An additive migration is order-independent in practice (the tables it touches were created by upstream's initial migrations), so sorting before a newer upstream migration is harmless.

**Never rename or re-timestamp a migration that has already shipped in a release.** Prisma tracks applied migrations by directory name; renaming one makes every existing deployment try to re-apply it and fail. `20260607125525_add_youtube_description_fields` is frozen for this reason, even though upstream migrations now sort after it.

Workflow for a local schema change:
1. Edit `packages/prisma/schema.prisma` with the new field/model (additive only).
2. Run `yarn prisma:dev --name <feature_name>` to generate the migration, then `yarn prisma:generate`.
3. Commit both the `schema.prisma` change and the generated migration.

A CI workflow (`.github/workflows/migration-drift.yml`) enforces the last point: it runs `prisma migrate diff --from-migrations --to-schema-datamodel --exit-code` on every PR and fails if `schema.prisma` has fields not covered by the committed migration files. That check also runs on every bot sync PR, so an upstream release that conflicts with a fork migration blocks the sync instead of reaching a deployment.

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
