# Shared git-rerere cache

This directory is the repo-tracked copy of git's rerere cache (`.git/rr-cache`).
rerere ("reuse recorded resolution") records how each conflict was resolved and
replays that resolution automatically the next time the same conflict appears —
which, for this downstream fork, means each conflict with upstream only ever
needs to be resolved by a human once.

How it's wired:

- **Locally**, the nix dev shell enables rerere and seeds git's live cache from
  this directory on shell entry (`scripts/rerere-cache.sh load`). After you
  resolve a conflict, run `scripts/rerere-cache.sh save` to copy the new entries
  back here, then commit them to share the resolution.
- **In CI**, `scripts/sync-upstream-rebase.sh` loads this cache before rebasing
  the fork onto a new upstream release and saves anything newly learned back,
  committing it as part of the sync it produces.

It is a copy rather than a symlink on purpose. The sync is a *rebase* onto an
upstream release tag, and replaying the fork's earliest commits checks out trees
that predate this directory. A symlinked `.git/rr-cache` dangles at that moment
and git aborts the rebase with "fatal: could not create directory".

Each subdirectory is one conflict, named by a hash of the conflict text, and
contains `preimage` (the conflict) and `postimage` (the resolution). Entries
are plain text and safe to delete if a recorded resolution becomes wrong —
the next manual resolution re-records it.
