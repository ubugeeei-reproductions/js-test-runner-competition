# js-test-runner-competition

Eight JavaScript test runners, one big frontend test suite.

- **The same 5,000 tests** for every runner (500 files, about 960 modules)
- **In a real browser** (Chromium) and **in happy-dom**
- **With and without module mocks** (`vi.mock` and its equivalents)

It started with one question: why do module mocks make Vitest's browser mode so slow?
The short answer is [here](docs/vi-mock-in-browser-mode.md).

## Try it

```sh
nix develop      # pinned toolchain; installs the dependencies the first time
vp run bench     # runs everything and prints the tables below
```

Or just one case:

```sh
vpr vitest:browser:mock
```

No Nix? Install Node 24+, Bun, Deno and [Vite+](https://viteplus.dev), then run `vp install`.
It works the same, but nothing is pinned.

## Results

<!-- results:start -->

Wall-clock time of the whole run, each runner with its default isolation.
**Bold**: the fastest in its column. **(×N)**: what the mocks cost that runner.

| Runner            | Browser, no mocks | Browser, with mocks | happy-dom, no mocks | happy-dom, with mocks |
| ----------------- | ----------------: | ------------------: | ------------------: | --------------------: |
| Vitest            |           137.4 s |   221.2 s ⚠ (×1.61) |             183.9 s |       184.0 s (×1.00) |
| Vite+ (`vp test`) |           139.3 s |   244.3 s ⚠ (×1.75) |             181.3 s |       183.4 s (×1.01) |
| Rstest            |       **103.0 s** | **102.5 s** (×1.00) |             130.8 s |       128.1 s (×0.98) |
| `uf test`         |    did not finish |                 n/a |              27.1 s |        32.7 s (×1.21) |
| Jest              |                 – |                   – |          **20.4 s** |    **23.1 s** (×1.13) |
| `bun test`        |                 – |                   – |              34.9 s |        34.5 s (×0.99) |
| `node --test`     |                 – |                   – |             241.6 s |       247.2 s (×1.02) |
| `deno test`       |                 – |                   – |             111.9 s |                   n/a |

<sub>5,000 tests in 500 files per suite · 1,883 mocks in the mock suite · 1 workers per runner · median of 3 rounds<br>n/a: `uf test` (browser): `--browser` cannot mock modules; `deno test` (happy-dom): no module mocking</sub>

⚠ Some tests failed:

- Vitest, browser, mock: failing tests per round 5 / 2 / 3, every one of them a mock that was not applied
- Vite+ (`vp test`), browser, mock: failing tests per round 5 / 3 / 3, every one of them a mock that was not applied
- `uf test`, browser, nomock: failing tests per round did not finish / did not finish / did not finish
- `node --test`, happy-dom, nomock, isolate: false: failing tests per round did not finish / did not finish / did not finish
- Vitest, browser, mock, parallel hoisted imports: failing tests per round 4 / 4 / 2, every one of them a mock that was not applied
- Vitest, browser, mock, HTTP cache kept while routed: failing tests per round 2 / 8 / 2, every one of them a mock that was not applied
- Vitest, browser, mock, both: failing tests per round 3 / 2 / 3, every one of them a mock that was not applied
- Vitest, browser, mixed: failing tests per round 3 / 0 / 4, every one of them a mock that was not applied

<details>
<summary>Every run: isolation on and off, CPU time</summary>

**In a real browser** (Playwright's headless Chromium):

| Runner            | isolate |       no mocks |                            with mocks | mocks cost | CPU, no mocks → mocks (of which Chromium) |
| ----------------- | ------- | -------------: | ------------------------------------: | ---------: | ----------------------------------------: |
| Vitest            | true    |        137.4 s |                             221.2 s ⚠ |  **×1.61** |         218.0 → 392.0 s (179.0 → 304.0 s) |
| Vite+ (`vp test`) | true    |        139.3 s |                             244.3 s ⚠ |  **×1.75** |         227.0 → 433.0 s (186.0 → 330.0 s) |
| Rstest            | true    |        103.0 s |                               102.5 s |  **×1.00** |             64.0 → 62.0 s (34.0 → 33.0 s) |
| `uf test`         | true    | did not finish | n/a (`--browser` cannot mock modules) |          – |                         – → – s (– → – s) |
| Vitest            | false   |         11.8 s |                                15.9 s |  **×1.36** |              15.0 → 22.0 s (7.0 → 12.0 s) |
| Vite+ (`vp test`) | false   |         11.3 s |                                17.1 s |  **×1.51** |              15.0 → 23.0 s (7.0 → 12.0 s) |
| Rstest            | false   |         15.1 s |                                15.9 s |  **×1.05** |             23.0 → 23.0 s (11.0 → 11.0 s) |

**In happy-dom** (no browser; every runner uses the same happy-dom):

| Runner            | isolate |       no mocks |                       with mocks | mocks cost | CPU, no mocks → mocks |
| ----------------- | ------- | -------------: | -------------------------------: | ---------: | --------------------: |
| Vitest            | true    |        183.9 s |                          184.0 s |  **×1.00** |       238.6 → 238.9 s |
| Vite+ (`vp test`) | true    |        181.3 s |                          183.4 s |  **×1.01** |       236.0 → 238.1 s |
| Rstest            | true    |        130.8 s |                          128.1 s |  **×0.98** |       153.2 → 150.5 s |
| Jest              | true    |         20.4 s |                           23.1 s |  **×1.13** |         26.6 → 31.9 s |
| `bun test`        | true    |         34.9 s |                           34.5 s |  **×0.99** |         49.0 → 48.6 s |
| `node --test`     | true    |        241.6 s |                          247.2 s |  **×1.02** |       325.9 → 335.1 s |
| `deno test`       | true    |        111.9 s |          n/a (no module mocking) |          – |           120.7 → – s |
| `uf test`         | true    |         27.1 s |                           32.7 s |  **×1.21** |         32.6 → 40.3 s |
| Vitest            | false   |          9.9 s |                           11.3 s |  **×1.14** |         13.3 → 15.1 s |
| Vite+ (`vp test`) | false   |         10.0 s |                           11.2 s |  **×1.11** |         13.4 → 15.0 s |
| Rstest            | false   |         20.8 s |                           28.0 s |  **×1.34** |         26.2 → 39.2 s |
| `bun test`        | false   |          2.6 s |                            3.3 s |  **×1.27** |           3.5 → 5.1 s |
| `node --test`     | false   | did not finish | n/a (mocks persist across files) |          – |               – → – s |

</details>

<details>
<summary>Vitest in a browser: the mixed suite, and the experimental patches</summary>

| Suite  | Variant                      |      time | vs. unpatched | CPU (of which Chromium) |
| ------ | ---------------------------- | --------: | ------------: | ----------------------: |
| nomock | unpatched                    |   137.4 s |             – |       218.0 s (179.0 s) |
| mixed  | unpatched                    | 184.1 s ⚠ |             – |       316.0 s (250.0 s) |
| mixed  | with #11083 (unreleased)     |   181.4 s |           -1% |       308.0 s (241.0 s) |
| mock   | unpatched                    | 221.2 s ⚠ |             – |       392.0 s (304.0 s) |
| mock   | parallel hoisted imports     | 213.6 s ⚠ |           -3% |       387.0 s (298.0 s) |
| mock   | HTTP cache kept while routed | 187.1 s ⚠ |          -15% |       312.0 s (233.0 s) |
| mock   | both                         | 181.9 s ⚠ |          -18% |       310.0 s (230.0 s) |
| mock   | with #11083 (unreleased)     |   192.2 s |          -13% |       326.0 s (243.0 s) |

</details>

<details>
<summary>Machine and versions</summary>

- AMD EPYC 9V45 96-Core Processor, 2 logical CPUs, 8 GiB RAM, Linux 6.17.0-1022-azure (x64), toolchain from flake.nix, 2026-10-09
- every browser run launched the same Chromium (`chromium_headless_shell-1243`)
- Node v26.10.0, vitest 5.0.3, vite 8.3.4, vite-plus 1.1.0, vite-plus's vitest 5.0.3, vite-plus's core 1.1.0 (Vite 8.3.3), @rstest/core 0.12.3, jest 30.5.2, bun 1.4.2, deno 2.9.7, uf 0.36.0, playwright 1.63.0, chromium (headless shell) 153.0.8010.12, happy-dom 20.14.6

</details>

<!-- results:end -->

Measured on GitHub Actions, inside `nix develop`.
Every runner runs in the same job, on the same machine, in alternating order.

## What's compared

### The suites

| Suite    | What's in it                                         |
| -------- | ---------------------------------------------------- |
| `nomock` | 500 test files, 10 tests each                        |
| `mock`   | the same files, plus 3–5 module mocks in each        |
| `mixed`  | every other file from `mock`, the rest from `nomock` |

The code under test looks like a real app: a design system, a shared layer, an app shell and 50
feature folders. A typical test file loads a few hundred modules.

### The runners

| Runner            | Browser | happy-dom |
| ----------------- | :-----: | :-------: |
| Vitest            |    ✓    |     ✓     |
| Vite+ (`vp test`) |    ✓    |     ✓     |
| Rstest            |    ✓    |     ✓     |
| Jest              |         |     ✓     |
| `bun test`        |         |     ✓     |
| `node --test`     |         |     ✓     |
| `deno test`       |         |    ✓ ¹    |
| `uf test`         |   ✓ ¹   |     ✓     |

¹ No module mocking there, so only the `nomock` suite runs.

Every runner gets the same number of workers, the same Chromium and the same happy-dom.
[Is the comparison fair?](docs/fairness.md)

## Running a single case

Every case of the benchmark is a `vpr` task:

```sh
vpr                          # pick one from a list
vpr vitest:browser           # nomock, then mock
vpr vitest:browser:mock      # <runner>:<env>:<suite>
vpr jest:happy-dom:nomock
REPRO_ISOLATE=false vpr bun:happy-dom:mock
```

And the benchmark takes a few options:

```sh
vp run bench --repeat 3
vp run bench --runners vitest,rstest --envs browser
vp run bench --experiments          # Vitest: the mixed suite, and the patches
vp run bench --profile --cpu-prof
vp run generate --features 20       # a smaller fixture
```

## Read more

- [Why `vi.mock` is slow in browser mode](docs/vi-mock-in-browser-mode.md)
- [Is the comparison fair?](docs/fairness.md)
- [One test file, eight runners](docs/host.md)
- [Profiling patches](docs/patches.md)
