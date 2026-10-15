# Why `vi.mock` is slow in browser mode

In Vitest's browser mode, the same 500 test files take **1.8× as long** once they use `vi.mock`
(105 s → 188 s on a 4-core CI machine). Rstest runs the same files with the same mocks at no extra
cost (75 s → 76 s). Without a browser, mocks cost every runner 1–3%, except uf (+20%).

Here is where the time goes. Everything below was found with the [profiling patches](patches.md)
and V8 CPU profiles, on Vitest 5.0.3.

## 1. Every request goes through Node

Each `vi.mock` call registers a Playwright route for the whole browser context.

Once a context has a route, Playwright intercepts **every** request in it, not only the mocked
module. Chromium pauses the request, Node checks it against every registered route, and tells
Chromium to go on. Every module of a mocked test file makes that round trip.

In numbers: 1,883 routes lead to about 400,000 route checks. Playwright's share of the Node main
thread's CPU time goes from 32% to 50%.

## 2. The HTTP cache is thrown away, once per file

Playwright turns interception on when the first route is added, and off when the last one is
removed. With `vi.mock`, that happens around every mocked test file.

Each time it turns interception on, Playwright sends `Network.setCacheDisabled({ cacheDisabled: true })`.
The effect, measured:

- without mocks, 97% of the module requests come back as `304 Not Modified`
- with mocks, only 8% do: nearly every module is sent again in full

It is the switching that hurts, not interception as such. Patching Playwright to leave the cache
setting alone brings the `304`s back (97%), makes the mocked suite **18% faster**, and takes
Chromium's CPU time from 500 s back down to 392 s (296 s without mocks).

## 3. Imports load one after another

To run the mocks before the imports, Vitest rewrites every `import` of the test file into its own
`await import(…)`. They run in sequence, so the module graph of a mocked file loads as a waterfall
instead of in parallel.

This one turned out not to matter much here: starting the imports in parallel saves nothing
measurable, because the time goes into points 1 and 2.

## 4. All of it lands on one thread

The Vite dev server, Vitest's RPC, and Playwright's client and server all share the Node main
thread. It is already busy during a browser run, so the extra work per request turns straight into
wall-clock time. On a busy machine it gets worse.

## 5. Sometimes the mock doesn't apply at all

Not about speed, but the benchmark catches it every time.

The last test of every mocked file checks that it got the mocked app context. In Vitest 5.0.3's
browser mode, a few files per run get the real module instead, at random: 0 to 2 of the 500
mocked files on a 4-core machine, 2 to 8 on a 2-core one. That is [vitest-dev/vitest#8339](https://github.com/vitest-dev/vitest/issues/8339):
when interception is switched back on for a file (point 2), its first module request can slip
through unmocked.

Rstest, with the same mocks, never misses. Neither does Vitest with #11083 (below).

## Why Rstest doesn't pay for it

Rstest bundles the test files and implements `rs.mock` inside the bundle. No request interception,
no cache switching, no import waterfall.

Without a browser, points 1 and 2 don't exist for any runner, and 3 is cheap: an import is a
function call, not a request.

## What about vitest-dev/vitest#11083?

[#11083](https://github.com/vitest-dev/vitest/pull/11083) was merged after 5.0.3, so it isn't
released yet. It fixes a flaky bug where a mock sometimes didn't apply.

The fix keeps interception on for the rest of the run, from the first `vi.mock` of a browser
context. That stops the switching from point 2: the misses of point 5 are gone, and about half of
the `304`s come back. But from then on, every request of that context goes through interception
(point 1), in mocked files and others.

Measured with a backport to 5.0.3:

- `mock` suite (every file mocks): **11% faster**
- `mixed` suite (every other file mocks): **11% slower**, because files without mocks now pay
  for interception too

## Profile

Browser mode, one round, with the profiling patches on and a CPU profile of the runner's Node processes.

<!-- profile:start -->

Per test file, unless noted:

| Run | test file import, p50 | requests per file | answered with 304 | `context.route()` registrations | route predicate calls | Node event loop busy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Vitest, browser, nomock | 542 ms | 222 | 97% | 0 | 0 | 67% |
| Vitest, browser, mock | 1149 ms | 214 | 8% | 1,883 | 401,575 | 83% |
| Vite+ (`vp test`), browser, nomock | 552 ms | 222 | 97% | 0 | 0 | 68% |
| Vite+ (`vp test`), browser, mock | 1195 ms | 214 | 9% | 1,883 | 401,580 | 86% |
| Vitest, browser, mock, parallel hoisted imports | 1098 ms | 214 | 8% | 1,883 | 401,480 | 86% |
| Vitest, browser, mock, HTTP cache kept while routed | 923 ms | 214 | 97% | 1,883 | 401,594 | 87% |
| Vitest, browser, mock, both | 859 ms | 214 | 97% | 1,883 | 401,435 | 88% |
| Vitest, browser, mock, with #11083 (unreleased) | 918 ms | 214 | 52% | 1,883 | 401,584 | 86% |
| Vitest, browser, mixed | 601 ms | 218 | 54% | 936 | 201,798 | 78% |
| Vitest, browser, mixed, with #11083 (unreleased) | 870 ms | 218 | 52% | 936 | 201,771 | 77% |

Where the runner's busiest Node process spends its CPU time (self time, by package):

- Vitest, browser, nomock (51.9 s busy): playwright-core 32%, node: internals 24%, (native) 14%, vite 9%, (program) 9%, (gc) 4%, rolldown 3%, @vitest/browser 2%
- Vitest, browser, mock (141.1 s busy): playwright-core 50%, vite 13%, node: internals 12%, (native) 11%, (gc) 5%, (program) 3%, rolldown 2%, @vitest/browser 1%
- Vite+ (`vp test`), browser, nomock (54.2 s busy): playwright-core 32%, node: internals 25%, (native) 14%, @voidzero-dev/vite-plus-core 12%, (program) 8%, (gc) 4%, @vitest/browser 2%, vitest 1%
- Vite+ (`vp test`), browser, mock (159.0 s busy): playwright-core 44%, @voidzero-dev/vite-plus-core 22%, node: internals 11%, (native) 11%, (gc) 6%, (program) 3%, @vitest/browser 1%, vitest 0%
- Rstest, browser, nomock (37.3 s busy): playwright-core 51%, node: internals 20%, (native) 15%, (gc) 4%, (program) 3%, @rsbuild/core 3%, @rstest/core 2%, @rstest/browser 1%
- Rstest, browser, mock (37.5 s busy): playwright-core 51%, node: internals 19%, (native) 15%, (gc) 5%, (program) 3%, @rsbuild/core 3%, @rstest/core 3%, @rstest/browser 1%
- Vitest, browser, mock, parallel hoisted imports (148.7 s busy): playwright-core 49%, vite 14%, node: internals 12%, (native) 12%, (gc) 6%, (program) 3%, rolldown 2%, @vitest/browser 1%
- Vitest, browser, mock, HTTP cache kept while routed (125.3 s busy): playwright-core 52%, node: internals 12%, vite 12%, (native) 11%, (gc) 5%, (program) 3%, rolldown 2%, @vitest/browser 1%
- Vitest, browser, mock, both (128.6 s busy): playwright-core 52%, node: internals 12%, vite 12%, (native) 11%, (gc) 6%, (program) 3%, rolldown 2%, @vitest/browser 1%
- Vitest, browser, mock, with #11083 (unreleased) (134.2 s busy): playwright-core 50%, vite 14%, node: internals 12%, (native) 12%, (gc) 5%, (program) 3%, rolldown 2%, @vitest/browser 1%
- Vitest, browser, mixed (97.9 s busy): playwright-core 45%, node: internals 15%, vite 12%, (native) 12%, (gc) 5%, (program) 4%, rolldown 2%, @vitest/browser 1%
- Vitest, browser, mixed, with #11083 (unreleased) (105.5 s busy): playwright-core 45%, node: internals 15%, (native) 14%, vite 13%, (gc) 5%, (program) 4%, rolldown 2%, @vitest/browser 1%

<details>
<summary>Machine and versions</summary>

- AMD EPYC 7763 64-Core Processor, 4 logical CPUs, 16 GiB RAM, Linux 6.17.0-1022-azure (x64), toolchain from flake.nix, 2026-10-15
- every browser run launched the same Chromium (`chromium_headless_shell-1243`)
- Node v26.10.0, vitest 5.0.3, vite 8.3.4, vite-plus 1.1.0, vite-plus's vitest 5.0.3, vite-plus's core 1.1.0 (Vite 8.3.3), @rstest/core 0.12.3, jest 30.5.2, bun 1.4.2, deno 2.9.7, uf 0.36.0, playwright 1.63.0, chromium (headless shell) 153.0.8010.12, happy-dom 20.14.6

</details>

<!-- profile:end -->
