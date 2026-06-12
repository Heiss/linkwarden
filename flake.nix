{
  description = "Linkwarden development environment";

  inputs = {
    # Pin to a stable channel. nixpkgs.prisma-engines MUST stay on the same
    # major version as the prisma npm package (currently 6.x).
    # When upgrading prisma npm to a new major, update this URL and run
    # `nix flake update` to regenerate flake.lock.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    # The pinned stable channel above carries an old claude-code (tied to the
    # release date). We pull claude-code from unstable so it stays current,
    # while everything else (notably prisma-engines) stays on the stable pin.
    nixpkgs-unstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, nixpkgs-unstable, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        # claude-code is an unfree package. Setting config.allowUnfree here means
        # the flake can install it without requiring NIXPKGS_ALLOW_UNFREE=1 in the
        # environment. Sourced from unstable to get a recent version.
        pkgs-unstable = import nixpkgs-unstable {
          inherit system;
          config.allowUnfree = true;
        };
      in {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            corepack_22
            # Playwright's postinstall needs system Chromium on NixOS
            chromium
            # Native deps used by some packages
            openssl
            pkg-config
            # Prisma
            prisma-engines
            # GitHub CLI
            gh
            # Claude Code (unfree; from unstable, enabled via config.allowUnfree)
            pkgs-unstable.claude-code
          ];

          shellHook = ''
            export PRISMA_QUERY_ENGINE_LIBRARY=${pkgs.prisma-engines}/lib/libquery_engine.node
            export PRISMA_QUERY_ENGINE_BINARY=${pkgs.prisma-engines}/bin/query-engine
            export PRISMA_SCHEMA_ENGINE_BINARY=${pkgs.prisma-engines}/bin/schema-engine
            # Playwright ships its own Chromium via apt-get, which doesn't exist on NixOS.
            # We provide Chromium via pkgs.chromium instead, so skip the npm install step.
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
            mkdir -p "$HOME/.local/bin"
            corepack enable --install-directory "$HOME/.local/bin" 2>/dev/null || true
            export PATH="$HOME/.local/bin:$PATH"

            # Upstream sync merges conflict in the same few inline spots;
            # rerere records each resolution once and replays it on later merges.
            # The cache is shared through the repo: .rr-cache/ is tracked, and
            # .git/rr-cache is symlinked to it so local resolutions show up as
            # committable files and resolutions merged from others apply here.
            if [ -d .git ] && [ ! -L .git/rr-cache ]; then
              mkdir -p .rr-cache
              if [ -d .git/rr-cache ]; then
                cp -R .git/rr-cache/. .rr-cache/ 2>/dev/null || true
                rm -rf .git/rr-cache
              fi
              ln -s ../.rr-cache .git/rr-cache
            fi
            git config rerere.enabled true 2>/dev/null || true
            # keep recorded resolutions ~forever (git gc would prune after 60 days)
            git config gc.rerereResolved 3650 2>/dev/null || true

            echo "Linkwarden dev shell ready. Run: yarn install"
          '';
        };
      }
    );
}
