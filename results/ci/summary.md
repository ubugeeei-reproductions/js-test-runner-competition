Wall-clock time of the whole run, each runner with its default isolation.
**Bold**: the fastest in its column. **(×N)**: what the mocks cost that runner.

| Runner            | Browser, no mocks | Browser, with mocks | happy-dom, no mocks | happy-dom, with mocks |
| ----------------- | ----------------: | ------------------: | ------------------: | --------------------: |
| Vitest            |           137.4 s |              failed |             183.9 s |       184.0 s (×1.00) |
| Vite+ (`vp test`) |           139.3 s |              failed |             181.3 s |       183.4 s (×1.01) |
| Rstest            |       **103.0 s** | **102.5 s** (×1.00) |             130.8 s |       128.1 s (×0.98) |
| `uf test`         |            failed |                 n/a |              27.1 s |        32.7 s (×1.21) |
| Jest              |                 – |                   – |          **20.4 s** |    **23.1 s** (×1.13) |
| `bun test`        |                 – |                   – |              34.9 s |        34.5 s (×0.99) |
| `node --test`     |                 – |                   – |             241.6 s |       247.2 s (×1.02) |
| `deno test`       |                 – |                   – |             111.9 s |                   n/a |

<sub>5,000 tests in 500 files per suite · 1,883 mocks in the mock suite · 1 workers per runner · median of 3 rounds<br>n/a: `uf test` (browser): `--browser` cannot mock modules; `deno test` (happy-dom): no module mocking</sub>

<details>
<summary>Every run: isolation on and off, CPU time</summary>

**In a real browser** (Playwright's headless Chromium):

| Runner            | isolate | no mocks |                            with mocks | mocks cost | CPU, no mocks → mocks (of which Chromium) |
| ----------------- | ------- | -------: | ------------------------------------: | ---------: | ----------------------------------------: |
| Vitest            | true    |  137.4 s |                                failed |          – |                 218.0 → – s (179.0 → – s) |
| Vite+ (`vp test`) | true    |  139.3 s |                                failed |          – |                 227.0 → – s (186.0 → – s) |
| Rstest            | true    |  103.0 s |                               102.5 s |  **×1.00** |             64.0 → 62.0 s (34.0 → 33.0 s) |
| `uf test`         | true    |   failed | n/a (`--browser` cannot mock modules) |          – |                         – → – s (– → – s) |
| Vitest            | false   |   11.8 s |                                15.9 s |  **×1.36** |              15.0 → 22.0 s (7.0 → 12.0 s) |
| Vite+ (`vp test`) | false   |   11.3 s |                                17.1 s |  **×1.51** |              15.0 → 23.0 s (7.0 → 12.0 s) |
| Rstest            | false   |   15.1 s |                                15.9 s |  **×1.05** |             23.0 → 23.0 s (11.0 → 11.0 s) |

**In happy-dom** (no browser; every runner uses the same happy-dom):

| Runner            | isolate | no mocks |                       with mocks | mocks cost | CPU, no mocks → mocks |
| ----------------- | ------- | -------: | -------------------------------: | ---------: | --------------------: |
| Vitest            | true    |  183.9 s |                          184.0 s |  **×1.00** |       238.6 → 238.9 s |
| Vite+ (`vp test`) | true    |  181.3 s |                          183.4 s |  **×1.01** |       236.0 → 238.1 s |
| Rstest            | true    |  130.8 s |                          128.1 s |  **×0.98** |       153.2 → 150.5 s |
| Jest              | true    |   20.4 s |                           23.1 s |  **×1.13** |         26.6 → 31.9 s |
| `bun test`        | true    |   34.9 s |                           34.5 s |  **×0.99** |         49.0 → 48.6 s |
| `node --test`     | true    |  241.6 s |                          247.2 s |  **×1.02** |       325.9 → 335.1 s |
| `deno test`       | true    |  111.9 s |          n/a (no module mocking) |          – |           120.7 → – s |
| `uf test`         | true    |   27.1 s |                           32.7 s |  **×1.21** |         32.6 → 40.3 s |
| Vitest            | false   |    9.9 s |                           11.3 s |  **×1.14** |         13.3 → 15.1 s |
| Vite+ (`vp test`) | false   |   10.0 s |                           11.2 s |  **×1.11** |         13.4 → 15.0 s |
| Rstest            | false   |   20.8 s |                           28.0 s |  **×1.34** |         26.2 → 39.2 s |
| `bun test`        | false   |    2.6 s |                            3.3 s |  **×1.27** |           3.5 → 5.1 s |
| `node --test`     | false   |   failed | n/a (mocks persist across files) |          – |               – → – s |

</details>

<details>
<summary>Vitest in a browser: the mixed suite, and the experimental patches</summary>

| Suite  | Variant                      |    time | vs. unpatched | CPU (of which Chromium) |
| ------ | ---------------------------- | ------: | ------------: | ----------------------: |
| nomock | unpatched                    | 137.4 s |             – |       218.0 s (179.0 s) |
| mixed  | unpatched                    |  failed |             – |       324.0 s (257.0 s) |
| mixed  | with #11083 (unreleased)     | 181.4 s |           -3% |       308.0 s (241.0 s) |
| mock   | unpatched                    |  failed |             – |               – s (– s) |
| mock   | parallel hoisted imports     |  failed |             – |               – s (– s) |
| mock   | HTTP cache kept while routed |  failed |             – |               – s (– s) |
| mock   | both                         |  failed |             – |               – s (– s) |
| mock   | with #11083 (unreleased)     | 192.2 s |             – |       326.0 s (243.0 s) |

</details>

<details>
<summary>Machine and versions</summary>

- AMD EPYC 9V45 96-Core Processor, 2 logical CPUs, 8 GiB RAM, Linux 6.17.0-1022-azure (x64), toolchain from flake.nix, 2026-10-09
- every browser run launched the same Chromium (`chromium_headless_shell-1243`)
- Node v26.10.0, vitest 5.0.3, vite 8.3.4, vite-plus 1.1.0, vite-plus's vitest 5.0.3, vite-plus's core 1.1.0 (Vite 8.3.3), @rstest/core 0.12.3, jest 30.5.2, bun 1.4.2, deno 2.9.7, uf 0.36.0, playwright 1.63.0, chromium (headless shell) 153.0.8010.12, happy-dom 20.14.6

</details>
