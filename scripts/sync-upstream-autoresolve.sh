#!/usr/bin/env bash
# Fork-owned script (see CLAUDE.md "Downstream Fork Strategy").
#
# CI helper for the upstream sync workflow: merges upstream/dev into the
# current branch, using git rerere to replay previously-seen conflict
# resolutions. Resolutions come from two sources:
#
#   1. .rr-cache/ — the rerere cache tracked in this repo. The nix dev shell
#      symlinks .git/rr-cache to it, so resolutions recorded locally become
#      ordinary committable files and ride along in PRs.
#   2. Training — before merging, the script replays the last $TRAIN_DEPTH
#      merge commits in history (same technique as git's contrib
#      rerere-train.sh): each conflicted merge that a human resolved teaches
#      rerere its resolution. This means a resolution is learned even if it
#      was never committed to .rr-cache.
#
# Newly learned cache entries are committed back to .rr-cache as part of the
# produced merge, so they propagate to developers when the sync PR merges.
#
# Exit codes:
#   0 — merge committed on the current branch (fully auto-resolved or clean)
#   2 — conflicts remain that rerere couldn't resolve; merge aborted;
#       unresolved paths printed one per line, prefixed "UNRESOLVED: "
#   3 — nothing to merge (HEAD already contains upstream)
#
# WARNING: training detaches and moves HEAD repeatedly. Run this only in a
# disposable CI checkout, never in a working tree you care about. It refuses
# to start if the worktree is dirty.
set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/linkwarden/linkwarden.git}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-dev}"
TRAIN_DEPTH="${TRAIN_DEPTH:-50}"

if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing to run: worktree is dirty" >&2
  exit 1
fi

gitdir=$(git rev-parse --git-dir)
start_ref=$(git rev-parse --abbrev-ref HEAD)
start_sha=$(git rev-parse HEAD)

git config rerere.enabled true
git config rerere.autoUpdate true
git config user.name >/dev/null 2>&1 || git config user.name "github-actions[bot]"
git config user.email >/dev/null 2>&1 || git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# Seed the live rerere cache from the tracked one (fresh CI checkouts have
# no .git/rr-cache; locally the dev shell symlinks them, making this a no-op).
if [ -d .rr-cache ] && [ ! -e "$gitdir/rr-cache" ]; then
  cp -R .rr-cache "$gitdir/rr-cache"
fi

git fetch --quiet "$UPSTREAM_URL" "$UPSTREAM_BRANCH"
upstream_sha=$(git rev-parse FETCH_HEAD)

if git merge-base --is-ancestor "$upstream_sha" HEAD; then
  echo "Nothing to merge: HEAD already contains upstream/$UPSTREAM_BRANCH"
  exit 3
fi

# --- Train rerere from past merge commits (contrib/rerere-train.sh logic) ---
echo "Training rerere from up to $TRAIN_DEPTH merge commits..."
for m in $(git rev-list --merges -n "$TRAIN_DEPTH" "$start_sha"); do
  p2=$(git rev-parse -q --verify "$m^2") || continue
  git checkout -q --detach "$m^1" 2>/dev/null || continue
  if ! git merge -q --no-edit "$p2" >/dev/null 2>&1; then
    if [ -s "$gitdir/MERGE_RR" ]; then
      echo "  learning from $(git show -s --format='%h %s' "$m")"
      git rerere >/dev/null 2>&1 || true
      git checkout -q "$m" -- .
      git rerere >/dev/null 2>&1 || true
    fi
    git merge --abort 2>/dev/null || true
  fi
  git reset -q --hard
done
git checkout -q "$start_ref"
git reset -q --hard "$start_sha"

# --- Attempt the real merge ---
echo "Merging upstream/$UPSTREAM_BRANCH ($upstream_sha) into $start_ref..."
if git merge --no-edit -m "Merge upstream $UPSTREAM_BRANCH into $start_ref (rerere auto-resolved)" "$upstream_sha" >/dev/null 2>&1; then
  echo "Merged cleanly without conflicts."
else
  unresolved=$(git diff --name-only --diff-filter=U)
  if [ -n "$unresolved" ]; then
    echo "rerere could not resolve all conflicts:"
    while IFS= read -r f; do echo "UNRESOLVED: $f"; done <<<"$unresolved"
    git merge --abort
    exit 2
  fi
  # All conflicts were auto-resolved and staged by rerere.autoUpdate.
  git commit -q --no-edit
  echo "All conflicts auto-resolved by rerere."
fi

# --- Persist newly learned resolutions into the tracked cache ---
mkdir -p .rr-cache
for d in "$gitdir"/rr-cache/*/; do
  [ -d "$d" ] || continue
  id=$(basename "$d")
  if ls "$d"postimage* >/dev/null 2>&1 && ! ls ".rr-cache/$id/"postimage* >/dev/null 2>&1; then
    rm -rf ".rr-cache/$id"
    mkdir -p ".rr-cache/$id"
    # only pre/postimage are the durable parts of an entry; thisimage is transient
    cp "$d"preimage* "$d"postimage* ".rr-cache/$id/"
  fi
done
if [ -n "$(git status --porcelain .rr-cache)" ]; then
  git add .rr-cache
  git commit -q -m "chore: record rerere resolutions for reuse in future syncs"
  echo "Committed newly learned rerere resolutions to .rr-cache/"
fi

echo "Done: $(git log --oneline -1)"
