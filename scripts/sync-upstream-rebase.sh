#!/usr/bin/env bash
# Fork-owned script (see CLAUDE.md "Downstream Fork Strategy").
#
# Moves the fork from the upstream release recorded in .github/upstream-release
# onto a newer one, by *rebasing* the fork's commits on top of the new release
# tag. The fork's commits therefore always sit on top of a tested upstream
# release, and the fork's own releases are cut from that.
#
# Conflicts are replayed from the rerere cache (.rr-cache/, see
# scripts/rerere-cache.sh), so a conflict a human already resolved once —
# locally or in an earlier sync — resolves itself here.
#
# Usage: scripts/sync-upstream-rebase.sh [<upstream-tag>]
#   Without an argument it targets the highest stable upstream release.
#
# Exit codes:
#   0 — rebased onto the target release; HEAD is the new fork history
#   2 — conflicts rerere could not resolve; rebase aborted, tree untouched;
#       unresolved paths printed one per line, prefixed "UNRESOLVED: "
#   3 — nothing to do (already on the target release)
#
# WARNING: rewrites the current branch. Run it in a disposable CI checkout or
# on a scratch branch, never on a branch you have not pushed. It refuses to
# start if the worktree is dirty.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/upstream-release.sh
source "$here/upstream-release.sh"

if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing to run: worktree is dirty" >&2
  exit 1
fi

gitdir=$(git rev-parse --git-dir)
branch=$(git rev-parse --abbrev-ref HEAD)

git config rerere.enabled true
git config rerere.autoUpdate true
git config user.name >/dev/null 2>&1 || git config user.name "github-actions[bot]"
git config user.email >/dev/null 2>&1 ||
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

fetch_upstream_tags
"$here/rerere-cache.sh" load

current=$(current_upstream_release)
target="${1:-$(latest_upstream_release)}"

current_sha=$(upstream_release_sha "$current") || {
  echo "Upstream release $current (from .github/upstream-release) not found upstream" >&2
  exit 1
}
target_sha=$(upstream_release_sha "$target") || {
  echo "Upstream release $target not found upstream" >&2
  exit 1
}

if [ "$current_sha" = "$target_sha" ]; then
  echo "Already on upstream $current; nothing to do"
  exit 3
fi

if ! git merge-base --is-ancestor "$current_sha" HEAD; then
  echo "Refusing to run: $current ($current_sha) is not an ancestor of $branch." >&2
  echo "The fork history does not start at the recorded upstream release —" >&2
  echo "fix .github/upstream-release or rebase manually." >&2
  exit 1
fi

echo "Rebasing $branch: upstream $current -> $target"
echo "  fork commits to replay: $(git rev-list --count "$current_sha..HEAD")"

# rerere.autoUpdate stages anything it can resolve, so a conflicted step may
# already be fully resolved by the time the rebase stops. Drive the rebase in a
# loop: bail out on anything still unresolved, otherwise continue (or skip a
# step that upstream has meanwhile adopted, leaving it empty).
set +e
GIT_EDITOR=true git rebase --empty=drop --onto "$target_sha" "$current_sha"
set -e

last_step=""
while [ -d "$gitdir/rebase-merge" ] || [ -d "$gitdir/rebase-apply" ]; do
  unresolved=$(git diff --name-only --diff-filter=U)
  if [ -n "$unresolved" ]; then
    echo "rerere could not resolve all conflicts:"
    while IFS= read -r f; do echo "UNRESOLVED: $f"; done <<<"$unresolved"
    git rebase --abort
    exit 2
  fi

  step=$(cat "$gitdir/rebase-merge/msgnum" 2>/dev/null || echo "?")
  if [ "$step" = "$last_step" ]; then
    echo "Rebase stopped making progress at step $step; aborting" >&2
    git rebase --abort
    exit 1
  fi
  last_step=$step

  git add -A
  set +e
  if git diff --cached --quiet; then
    GIT_EDITOR=true git rebase --skip
  else
    GIT_EDITOR=true git rebase --continue
  fi
  set -e
done

echo "Rebase complete: $(git rev-list --count "$target_sha..HEAD") fork commit(s) on $target"

# Record the new base and any resolutions learned along the way, as commits on
# top of the replayed fork history.
rf=$(release_file)
{
  grep '^[[:space:]]*#' "$rf" || true
  printf '%s\n' "$target"
} >"$rf.tmp"
mv "$rf.tmp" "$rf"
git add "$rf"
git commit -q -m "chore(upstream): move fork base from $current to $target"

"$here/rerere-cache.sh" save
if [ -n "$(git status --porcelain .rr-cache)" ]; then
  git add .rr-cache
  git commit -q -m "chore(rerere): record resolutions from the $target rebase"
  echo "Committed newly learned rerere resolutions to .rr-cache/"
fi

echo "Done: $(git log --oneline -1)"
