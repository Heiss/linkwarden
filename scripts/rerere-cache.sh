#!/usr/bin/env bash
# Fork-owned script (see CLAUDE.md "Downstream Fork Strategy").
#
# Moves recorded conflict resolutions between git's live rerere cache
# (.git/rr-cache, not tracked) and .rr-cache/ (tracked, shared through the
# repo). Each conflict with upstream then only ever needs to be resolved by a
# human once — locally or by the sync bot, whichever hits it first.
#
#   scripts/rerere-cache.sh load   # .rr-cache/      -> .git/rr-cache/
#   scripts/rerere-cache.sh save   # .git/rr-cache/  -> .rr-cache/  (then commit)
#   scripts/rerere-cache.sh sync   # load, then save
#
# Why not just symlink .git/rr-cache to the tracked directory (what this fork
# did before): the sync is a *rebase* onto an upstream release, and replaying
# the fork's first commits checks out trees that predate .rr-cache/. The
# symlink then dangles mid-rebase and git aborts with
# "fatal: could not create directory '.git/rr-cache'". A real directory plus
# an explicit copy survives that.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
gitdir=$(git rev-parse --git-common-dir)
case "$gitdir" in /*) ;; *) gitdir="$root/$gitdir" ;; esac
live="$gitdir/rr-cache"
tracked="$root/.rr-cache"

# An entry is durable once it has a postimage; thisimage/preimage-only entries
# are in-flight state from a conflict that is not resolved yet.
copy_entries() {
  local from=$1 to=$2 label=$3 copied=0
  mkdir -p "$to"
  for d in "$from"/*/; do
    [ -d "$d" ] || continue
    local id
    id=$(basename "$d")
    ls "$d"postimage* >/dev/null 2>&1 || continue
    ls "$to/$id/"postimage* >/dev/null 2>&1 && continue
    rm -rf "${to:?}/$id"
    mkdir -p "$to/$id"
    cp "$d"preimage* "$d"postimage* "$to/$id/"
    copied=$((copied + 1))
  done
  echo "$label: $copied new resolution(s)"
}

case "${1:-sync}" in
load) copy_entries "$tracked" "$live" "loaded into .git/rr-cache" ;;
save) copy_entries "$live" "$tracked" "saved into .rr-cache" ;;
sync)
  copy_entries "$tracked" "$live" "loaded into .git/rr-cache"
  copy_entries "$live" "$tracked" "saved into .rr-cache"
  ;;
*)
  echo "usage: $0 {load|save|sync}" >&2
  exit 1
  ;;
esac
