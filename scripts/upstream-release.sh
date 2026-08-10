#!/usr/bin/env bash
# Fork-owned script (see CLAUDE.md "Downstream Fork Strategy").
#
# Shared helpers for everything that needs to know which upstream *release*
# this fork sits on. The fork deliberately tracks published releases only
# (never upstream/dev), so migrations and features arrive as tested units
# instead of a moving tip.
#
# Upstream tags are fetched into their own ref namespace, refs/upstream/tags/*,
# because the fork publishes its releases under the *same* version numbers
# (fork v2.16.0 == upstream v2.16.0 + fork commits). Fetching them into
# refs/tags/* would clobber the fork's own release tags.
#
# Sourced by the other scripts; also runnable directly to print the plan:
#   scripts/upstream-release.sh            # current + latest + whether behind
set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/linkwarden/linkwarden.git}"
UPSTREAM_TAG_NS="refs/upstream/tags"

repo_root() { git rev-parse --show-toplevel; }

release_file() { echo "$(repo_root)/.github/upstream-release"; }

# The upstream release the fork is currently rebased onto, e.g. "v2.16.0".
current_upstream_release() {
  grep -v '^[[:space:]]*#' "$(release_file)" | grep -v '^[[:space:]]*$' | head -n1 | tr -d '[:space:]'
}

# Mirror upstream's tags into refs/upstream/tags/* (see note above).
fetch_upstream_tags() {
  git fetch --quiet --no-tags --force "$UPSTREAM_URL" "+refs/tags/*:$UPSTREAM_TAG_NS/*"
}

# Resolve an upstream release tag to a commit in this repo.
upstream_release_sha() {
  git rev-parse --verify --quiet "$UPSTREAM_TAG_NS/$1^{commit}"
}

# Highest stable upstream release. Pre-releases (v2.17.0-rc.1, -beta, ...) are
# skipped on purpose: the whole point of tracking releases is to get versions
# upstream considers done.
latest_upstream_release() {
  git for-each-ref --format='%(refname:strip=3)' "$UPSTREAM_TAG_NS" |
    grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' |
    sort -V |
    tail -n1
}

# Print the plan as KEY=VALUE lines (also valid for $GITHUB_OUTPUT).
upstream_release_plan() {
  local current latest behind=false
  current=$(current_upstream_release)
  latest=$(latest_upstream_release)
  if [ -z "$latest" ]; then
    echo "No upstream release tags found in $UPSTREAM_TAG_NS" >&2
    return 1
  fi
  if [ "$current" != "$latest" ] &&
    [ "$(printf '%s\n%s\n' "$current" "$latest" | sort -V | tail -n1)" = "$latest" ]; then
    behind=true
  fi
  echo "current=$current"
  echo "latest=$latest"
  echo "behind=$behind"
}

# Direct invocation: fetch and print the plan.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  fetch_upstream_tags
  upstream_release_plan
fi
