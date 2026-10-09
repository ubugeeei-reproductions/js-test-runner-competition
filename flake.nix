{
  description = "js-test-runner-competition: the pinned environment the benchmark runs in";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # uf ships prebuilt binaries only (https://github.com/ubugeeei-prod/uf/releases).
      ufVersion = "0.36.0";
      ufReleases = {
        aarch64-darwin = {
          target = "aarch64-apple-darwin";
          hash = "sha256-QS+icre6szhGp/Jyo6DrO7CqlNQFgGRwF5FgyVcNmHo=";
        };
        x86_64-darwin = {
          target = "x86_64-apple-darwin";
          hash = "sha256-upXU+JfPMPGndmb5QHho5ioGFo67AiFt05pC2DjwOEs=";
        };
        aarch64-linux = {
          target = "aarch64-unknown-linux-gnu";
          hash = "sha256-ssrNQUe/GgFrB7X3wBOkz+dV4UsbuMWjIR+PlDJrkTY=";
        };
        x86_64-linux = {
          target = "x86_64-unknown-linux-gnu";
          hash = "sha256-9WZtCrFuFY4mJTm/kQxBvVtc5b8DbTNWSDBCjq/CQZU=";
        };
      };
    in
    {
      packages = forAllSystems (
        pkgs:
        let
          release = ufReleases.${pkgs.stdenv.hostPlatform.system};
        in
        {
          uf = pkgs.stdenvNoCC.mkDerivation {
            pname = "uf";
            version = ufVersion;
            src = pkgs.fetchurl {
              url = "https://github.com/ubugeeei-prod/uf/releases/download/uf%40${ufVersion}/uf-${release.target}.tar.gz";
              inherit (release) hash;
            };
            sourceRoot = ".";
            nativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.autoPatchelfHook ];
            buildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.stdenv.cc.cc.lib ];
            installPhase = ''
              mkdir -p $out
              cp -r bin $out/bin
            '';
          };

          # The Chromium Playwright drives. Its version is tied to the `playwright` npm package, which
          # package.json pins to the same version as nixpkgs' playwright-driver.
          chromium = pkgs.playwright-driver.browsers.override {
            withChromium = false;
            withChromiumHeadlessShell = true;
            withFirefox = false;
            withWebkit = false;
            withFfmpeg = false;
          };
        }
      );

      devShells = forAllSystems (
        pkgs:
        let
          own = self.packages.${pkgs.stdenv.hostPlatform.system};
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_26
              pkgs.pnpm
              pkgs.bun
              pkgs.deno
              own.uf
              # `time -p`: total CPU time of a benchmark run, waited-for child processes included
              pkgs.time
            ];
            # Playwright (Vitest, Vite+, Rstest) uses the Nix-built Chromium and downloads nothing.
            PLAYWRIGHT_BROWSERS_PATH = "${own.chromium}";
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
            PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "1";
            PLAYWRIGHT_DRIVER_VERSION = pkgs.playwright-driver.version;
            # scripts/bench.ts runs these instead of looking for its own copies.
            REPRO_BUN = "${pkgs.bun}/bin/bun";
            REPRO_DENO = "${pkgs.deno}/bin/deno";
            REPRO_UF = "${own.uf}/bin/uf";
            REPRO_TIME = "${pkgs.time}/bin/time";
            REPRO_ENVIRONMENT = "nix";
            # `vp` (Vite+) and the test runners come from the lockfile: installed on first entry, and
            # node_modules/.bin goes first on PATH, so every command below is `vp …` / `vpr …`.
            shellHook = ''
              export PATH="$PWD/node_modules/.bin:$PATH"
              if [ ! -d node_modules/.pnpm ]; then pnpm install --frozen-lockfile; fi
            '';
          };
        }
      );
    };
}
