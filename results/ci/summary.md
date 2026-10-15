
Wall-clock time of the whole run, each runner with its default isolation.
**Bold**: the fastest in its column. **(×N)**: what the mocks cost that runner.

| Runner | Browser, no mocks | Browser, with mocks | happy-dom, no mocks | happy-dom, with mocks |
| --- | ---: | ---: | ---: | ---: |
| Vitest | 105.3 s | 188.2 s ⚠ (×1.79) | 135.5 s | 137.2 s (×1.01) |
| Vite+ (`vp test`) | 106.5 s | 196.4 s ⚠ (×1.84) | 135.6 s | 137.2 s (×1.01) |
| Rstest | **74.8 s** | **75.7 s** (×1.01) | 97.1 s | 99.2 s (×1.02) |
| `uf test` | 97.2 s | n/a | 22.7 s | 27.3 s (×1.20) |
| Jest | – | – | **17.1 s** | **17.6 s** (×1.03) |
| `bun test` | – | – | 24.3 s | 24.6 s (×1.01) |
| `node --test` | – | – | 188.4 s | 190.6 s (×1.01) |
| `deno test` | – | – | 86.0 s | n/a |

<sub>5,000 tests in 500 files per suite · 1,883 mocks in the mock suite · 3 workers per runner · median of 3 rounds<br>n/a: `uf test` (browser): `--browser` cannot mock modules; `deno test` (happy-dom): no module mocking</sub>

⚠ Some tests failed:

- Vitest, browser, mock: failing tests per round 2 / 0 / 2, every one of them a mock that was not applied
- Vite+ (`vp test`), browser, mock: failing tests per round 1 / 0 / 0, every one of them a mock that was not applied
- Vitest, browser, mock, parallel hoisted imports: failing tests per round 3 / 1 / 1, every one of them a mock that was not applied
- Vitest, browser, mock, HTTP cache kept while routed: failing tests per round 2 / 0 / 1, every one of them a mock that was not applied
- Vitest, browser, mock, both: failing tests per round 0 / 1 / 1, every one of them a mock that was not applied
- Vitest, browser, mixed: failing tests per round 0 / 1 / 1, every one of them a mock that was not applied

<details>
<summary>Every run: isolation on and off, CPU time</summary>

**In a real browser** (Playwright's headless Chromium):

| Runner | isolate | no mocks | with mocks | mocks cost | CPU, no mocks → mocks (of which Chromium) |
| --- | --- | ---: | ---: | ---: | ---: |
| Vitest | true | 105.3 s | 188.2 s ⚠ | **×1.79** | 352.0 → 644.0 s (296.0 → 500.0 s) |
| Vite+ (`vp test`) | true | 106.5 s | 196.4 s ⚠ | **×1.84** | 357.0 → 663.0 s (297.0 → 507.0 s) |
| Rstest | true | 74.8 s | 75.7 s | **×1.01** | 87.0 → 88.0 s (45.0 → 45.0 s) |
| `uf test` | true | 97.2 s | n/a (`--browser` cannot mock modules) | – | 362.0 → – s (329.0 → – s) |
| Vitest | false | 11.7 s | 16.3 s | **×1.39** | 32.0 → 44.0 s (18.0 → 27.0 s) |
| Vite+ (`vp test`) | false | 12.1 s | 16.9 s | **×1.40** | 31.0 → 45.0 s (17.0 → 27.0 s) |
| Rstest | false | 14.2 s | 14.3 s | **×1.01** | 34.0 → 34.0 s (18.0 → 18.0 s) |

**In happy-dom** (no browser; every runner uses the same happy-dom):

| Runner | isolate | no mocks | with mocks | mocks cost | CPU, no mocks → mocks |
| --- | --- | ---: | ---: | ---: | ---: |
| Vitest | true | 135.5 s | 137.2 s | **×1.01** | 451.3 → 455.5 s |
| Vite+ (`vp test`) | true | 135.6 s | 137.2 s | **×1.01** | 450.4 → 454.9 s |
| Rstest | true | 97.1 s | 99.2 s | **×1.02** | 288.3 → 294.5 s |
| Jest | true | 17.1 s | 17.6 s | **×1.03** | 56.6 → 58.0 s |
| `bun test` | true | 24.3 s | 24.6 s | **×1.01** | 86.3 → 86.9 s |
| `node --test` | true | 188.4 s | 190.6 s | **×1.01** | 613.3 → 622.3 s |
| `deno test` | true | 86.0 s | n/a (no module mocking) | – | 261.1 → – s |
| `uf test` | true | 22.7 s | 27.3 s | **×1.20** | 72.2 → 88.4 s |
| Vitest | false | 10.0 s | 11.0 s | **×1.11** | 28.2 → 30.7 s |
| Vite+ (`vp test`) | false | 10.2 s | 11.2 s | **×1.10** | 28.6 → 30.9 s |
| Rstest | false | 12.5 s | 13.4 s | **×1.08** | 39.9 → 43.3 s |
| `bun test` | false | 2.8 s | 3.3 s | **×1.17** | 9.8 → 11.8 s |
| `node --test` | false | 53.9 s | n/a (mocks persist across files) | – | 63.7 → – s |

</details>

<details>
<summary>Vitest in a browser: the mixed suite, and the experimental patches</summary>

| Suite | Variant | time | vs. unpatched | CPU (of which Chromium) |
| --- | --- | ---: | ---: | ---: |
| nomock | unpatched | 105.3 s | – | 352.0 s (296.0 s) |
| mixed | unpatched | 146.7 s ⚠ | – | 501.0 s (399.0 s) |
| mixed | with #11083 (unreleased) | 162.9 s | +11% | 549.0 s (436.0 s) |
| mock | unpatched | 188.2 s ⚠ | – | 644.0 s (500.0 s) |
| mock | parallel hoisted imports | 187.9 s ⚠ | -0% | 647.0 s (500.0 s) |
| mock | HTTP cache kept while routed | 155.0 s ⚠ | -18% | 521.0 s (392.0 s) |
| mock | both | 154.4 s ⚠ | -18% | 532.0 s (399.0 s) |
| mock | with #11083 (unreleased) | 167.5 s | -11% | 562.0 s (424.0 s) |

</details>

<details>
<summary>Machine and versions</summary>

- AMD EPYC 7763 64-Core Processor, 4 logical CPUs, 16 GiB RAM, Linux 6.17.0-1022-azure (x64), toolchain from flake.nix, 2026-10-15
- every browser run launched the same Chromium (`chromium_headless_shell-1243`)
- Node v26.10.0, vitest 5.0.3, vite 8.3.4, vite-plus 1.1.0, vite-plus's vitest 5.0.3, vite-plus's core 1.1.0 (Vite 8.3.3), @rstest/core 0.12.3, jest 30.5.2, bun 1.4.2, deno 2.9.7, uf 0.36.0, playwright 1.63.0, chromium (headless shell) 153.0.8010.12, happy-dom 20.14.6

</details>
