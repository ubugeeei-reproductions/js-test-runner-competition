# Is the comparison fair?

Short version: the runners get the same tests, the same machine and the same tools. Where a
runner can't do something, the table says so instead of guessing.

## Same inputs

- **Same tests.** Every runner runs the exact same test files ([how](host.md)).
- **Same mocks.** Only the kinds every runner supports: a plain factory, or `{ spy: true }`.
- **Proof that mocks apply.** The last test of every file checks which module it got: `"Test User"`
  from the mock, `"Guest"` from the real one.

## Same machine

- **One job.** Every runner runs in the same CI job, on the same freshly provisioned machine.
- **Alternating order.** The order rotates every round, and the median is reported.
- **Pinned tools.** Node, Bun, Deno, uf and Chromium come from `flake.nix`, everything else from
  `pnpm-lock.yaml`.

## Same settings

- **Same number of workers** for every runner: `min(12, CPUs − 1)`, Vitest's and Rstest's own
  default in browser mode.
- **Same Chromium.** Vitest, Vite+ and Rstest launch it through Playwright, and uf through
  `UF_BROWSER`. Every run records which executable it started.
- **Same happy-dom** for every runner without a browser.
- **Warm caches.** Jest and Deno keep compiled files on disk, so every runner runs each suite once
  before measuring.

## Where runners differ

Some differences are part of the runner, so they stay in.

- **Vitest serves modules one by one.** Every isolated test file loads its few hundred modules
  again from the dev server. Rstest serves one bundle per file. That's why Vitest is slower even
  without mocks. The `isolate: false` rows take this out.
- **Rstest isolates more, not less.** It opens a new browser context per file. Vitest opens a new
  iframe.
- **The "mocks cost" column** compares each runner with itself, so it doesn't depend on any of this.

## What some runners can't do

- **`deno test`** has no module mocking. Only `nomock` runs.
- **`node --test`** needs process isolation for mocks: without it, a mock from one file stays
  registered for the next. Without isolation, only `nomock` runs.
- **`uf test --browser`** can't mock modules, and only serves JavaScript with relative imports. It
  runs a JavaScript copy of `nomock` (see [host.md](host.md#uf-in-the-browser)).
