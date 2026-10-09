# Profiling patches

[`patches/`](../patches) holds `pnpm patch` patches. They're always installed, but do nothing
until you set their environment variable.

## Measuring

| Package                      | Variable         | What it records                                                                     |
| ---------------------------- | ---------------- | ----------------------------------------------------------------------------------- |
| `@vitest/browser`            | `REPRO_PROF_DIR` | per test file: requests and load time; server side: `200` vs `304`, event loop load |
| `@vitest/browser-playwright` | `REPRO_PROF_DIR` | routes added, route checks, time spent adding and removing routes                   |

`vp run bench --profile` turns them on and prints a summary.
[`scripts/profile.ts`](../scripts/profile.ts) reads what they write.

## Experiments

| Package                      | Variable                       | What it changes                                                                                 |
| ---------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `@vitest/mocker`             | `REPRO_EXP_PARALLEL_IMPORTS=1` | starts all of a file's imports at once, not one by one                                          |
| `playwright-core`            | `REPRO_EXP_KEEP_CACHE=1`       | leaves the HTTP cache alone while intercepting                                                  |
| `@vitest/browser-playwright` | `REPRO_EXP_PR11083=1`          | [vitest-dev/vitest#11083](https://github.com/vitest-dev/vitest/pull/11083), backported to 5.0.3 |

`vp run bench --experiments` runs each of them on Vitest's `mock` suite, and #11083 on `mixed` too.

## Notes

- `vp test` uses Vite+'s own Vitest and Vite. The Playwright provider package is shared with the
  standalone Vitest, because pnpm resolves its peers to the standalone install.
- `playwright` is pinned to the version of nixpkgs' `playwright-driver`. That way Playwright uses
  the Chromium from Nix and downloads nothing.
