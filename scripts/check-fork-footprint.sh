#!/usr/bin/env bash
# Fork-owned script (see CLAUDE.md "Downstream Fork Strategy").
#
# Enforces the fork strategy mechanically: every upstream-owned file the fork
# modifies must be declared in .github/fork-footprint-budget.tsv with a maximum
# number of added/deleted lines. The check fails when
#   - an upstream-owned file is modified but not declared, or
#   - a file's diff vs upstream exceeds its declared budget.
#
# "Upstream-owned" means the file exists at the merge-base with upstream/dev.
# Files that exist only in the fork (new modules, workflows, CLAUDE.md, ...)
# are never checked — they can't conflict with upstream.
#
# This is what makes the fork rules forget-proof: an accidental
# `prisma format` (which re-aligns upstream lines in schema.prisma) shows up
# as deletions and fails; any creeping inline edit to an upstream file fails
# until it is either moved into a fork-owned module or consciously budgeted
# in a reviewed diff.
#
# Usage: scripts/check-fork-footprint.sh
#   UPSTREAM_URL / UPSTREAM_BRANCH env vars override the defaults.
set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/linkwarden/linkwarden.git}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-dev}"
BUDGET_FILE="$(git rev-parse --show-toplevel)/.github/fork-footprint-budget.tsv"

# Lockfiles are machine-generated; conflicts there are resolved by
# regenerating, not hand-editing, and their counts churn with every
# dependency sync. Auditing them line-by-line has no merge-conflict value.
EXCLUDED='^(yarn\.lock|flake\.lock)$'

if [ ! -f "$BUDGET_FILE" ]; then
  echo "Budget file not found: $BUDGET_FILE" >&2
  exit 1
fi

git fetch --quiet "$UPSTREAM_URL" "$UPSTREAM_BRANCH"
upstream_ref=$(git rev-parse FETCH_HEAD)
base=$(git merge-base HEAD "$upstream_ref")
echo "Comparing working tree against merge-base with upstream/$UPSTREAM_BRANCH: $base"
echo

failures=0
printf '%-60s %12s %12s\n' "upstream-owned file" "added" "deleted"

while IFS=$'\t' read -r added deleted path; do
  [ -z "$path" ] && continue
  if echo "$path" | grep -Eq "$EXCLUDED"; then
    continue
  fi
  # Skip fork-owned files (not present at the merge-base).
  if ! git cat-file -e "$base:$path" 2>/dev/null; then
    continue
  fi
  # Binary files report "-"; treat as unbudgetable.
  [ "$added" = "-" ] && added=999999
  [ "$deleted" = "-" ] && deleted=999999

  budget=$(awk -F'\t' -v p="$path" '!/^#/ && $1 == p { print; exit }' "$BUDGET_FILE")
  if [ -z "$budget" ]; then
    printf '%-60s %12s %12s  NOT DECLARED\n' "$path" "$added" "$deleted"
    failures=1
    continue
  fi
  max_added=$(echo "$budget" | cut -f2)
  max_deleted=$(echo "$budget" | cut -f3)
  if [ "$added" -gt "$max_added" ] || [ "$deleted" -gt "$max_deleted" ]; then
    printf '%-60s %12s %12s  OVER BUDGET (max %s/%s)\n' \
      "$path" "$added" "$deleted" "$max_added" "$max_deleted"
    failures=1
  else
    printf '%-60s %12s %12s  ok (max %s/%s)\n' \
      "$path" "$added" "$deleted" "$max_added" "$max_deleted"
  fi
# Diffing against the working tree (not HEAD) so local runs catch mistakes
# before they are committed; in CI the checkout is clean, so it's equivalent.
done < <(git diff --numstat --no-renames "$base")

if [ "$failures" -ne 0 ]; then
  cat >&2 <<'EOF'

Fork footprint check FAILED.

An upstream-owned file diverges from upstream more than its declared budget
in .github/fork-footprint-budget.tsv. Per the fork strategy (CLAUDE.md,
"Downstream Fork Strategy"), fix it one of these ways, in order of preference:

  1. Move the change into a fork-owned module and leave only a one-line
     import/call in the upstream file.
  2. If the inline edit is genuinely necessary, add or raise the budget entry
     in .github/fork-footprint-budget.tsv in the same PR, so the increase is
     explicit and reviewed.

Special case: deletions in packages/prisma/schema.prisma usually mean
`prisma format` re-aligned upstream lines. Revert the re-alignment and keep
fork fields as purely additive lines — do not run `prisma format` on this
file.
EOF
  exit 1
fi

echo
echo "Fork footprint check passed."
