# Shared git-rerere cache

This directory is the repo-tracked copy of git's rerere cache (`.git/rr-cache`).
rerere ("reuse recorded resolution") records how each merge conflict was
resolved and replays that resolution automatically the next time the same
conflict appears — which, for this downstream fork, means each conflict with
upstream only ever needs to be resolved by a human once.

How it's wired (nothing to do manually):

- **Locally**, the nix dev shell symlinks `.git/rr-cache` to this directory and
  enables rerere. After you resolve a merge conflict and commit, new entries
  appear here as untracked files — commit them to share the resolution.
- **In CI**, the upstream-sync workflow seeds its cache from this directory
  *and* re-learns resolutions by replaying recent merge commits from history
  (`scripts/sync-upstream-autoresolve.sh`). So even a resolution that was
  never committed here is recovered automatically from the merge commit it
  produced. Newly learned entries get committed back here as part of the
  bot's auto-resolved sync PRs.

Each subdirectory is one conflict, named by a hash of the conflict text, and
contains `preimage` (the conflict) and `postimage` (the resolution). Entries
are plain text and safe to delete if a recorded resolution becomes wrong —
the next manual resolution re-records it.
