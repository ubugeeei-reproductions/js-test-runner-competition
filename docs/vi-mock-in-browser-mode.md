# Why `vi.mock` is slow in browser mode

In Vitest's browser mode, a test file that uses `vi.mock` is a lot slower than the same file without it.
Rstest runs the same files with the same mocks at almost no extra cost.

Here is where the time goes. Everything below was found with the [profiling patches](patches.md)
and V8 CPU profiles, on Vitest 5.0.3.

## 1. Every request goes through Node

Each `vi.mock` call registers a Playwright route for the whole browser context.

Once a context has a route, Playwright intercepts **every** request in it, not only the mocked
module. Chromium pauses the request, Node checks it against every registered route, and tells
Chromium to go on. Every module of a mocked test file makes that round trip.

## 2. The HTTP cache is thrown away, once per file

Playwright turns interception on when the first route is added, and off when the last one is
removed. With `vi.mock`, that happens around every mocked test file.

Each time it turns interception on, Playwright sends `Network.setCacheDisabled({ cacheDisabled: true })`.
The effect, measured:

- without mocks, about a quarter of the module requests come back as `304 Not Modified`
- in a mocked file, none do: every module is sent again in full

It is the switching that hurts, not interception as such. Keeping interception on for the whole
run, or never touching the cache setting, brings the `304`s back.

## 3. Imports load one after another

To run the mocks before the imports, Vitest rewrites every `import` of the test file into its own
`await import(…)`. They run in sequence, so the module graph of a mocked file loads as a waterfall
instead of in parallel.

## 4. All of it lands on one thread

The Vite dev server, Vitest's RPC, and Playwright's client and server all share the Node main
thread. It is already busy during a browser run, so the extra work per request turns straight into
wall-clock time. On a busy machine it gets worse.

## Why Rstest doesn't pay for it

Rstest bundles the test files and implements `rs.mock` inside the bundle. No request interception,
no cache switching, no import waterfall.

Without a browser, points 1 and 2 don't exist for any runner, and 3 is cheap: an import is a
function call, not a request.

## What about vitest-dev/vitest#11083?

[#11083](https://github.com/vitest-dev/vitest/pull/11083) was merged after 5.0.3, so it isn't
released yet. It fixes a flaky bug where a mock sometimes didn't apply.

The fix keeps interception on for the rest of the run, from the first `vi.mock` of a browser
context. That happens to stop the switching from point 2, so the `304`s come back. But from then on,
every request of that context goes through interception (point 1), in mocked files and others.

The benchmark measures a backport of it on the `mock` and `mixed` suites (`--experiments`).

## Profile

Browser mode, one round, with the profiling patches on and a CPU profile of the runner's Node processes.

<!-- profile:start -->

Per test file, unless noted:

| Run                                                 | test file import, p50 | requests per file | answered with 304 | `context.route()` registrations | route predicate calls | Node event loop busy |
| --------------------------------------------------- | --------------------: | ----------------: | ----------------: | ------------------------------: | --------------------: | -------------------: |
| Vitest, browser, nomock                             |                207 ms |               222 |               98% |                               0 |                     0 |                  52% |
| Vitest, browser, mock                               |                411 ms |               214 |                8% |                           1,883 |               401,623 |                  64% |
| Vite+ (`vp test`), browser, nomock                  |                201 ms |               222 |               98% |                               0 |                     0 |                  52% |
| Vite+ (`vp test`), browser, mock                    |                428 ms |               214 |                9% |                           1,883 |               401,622 |                  66% |
| Vitest, browser, mock, parallel hoisted imports     |                418 ms |               214 |                8% |                           1,883 |               401,615 |                  66% |
| Vitest, browser, mock, HTTP cache kept while routed |                356 ms |               214 |               98% |                           1,883 |               401,683 |                  65% |
| Vitest, browser, mock, both                         |                335 ms |               214 |               98% |                           1,883 |               401,644 |                  66% |
| Vitest, browser, mock, with #11083 (unreleased)     |                335 ms |               214 |               74% |                           1,883 |               401,601 |                  65% |
| Vitest, browser, mixed                              |                226 ms |               218 |               55% |                             936 |               201,806 |                  59% |
| Vitest, browser, mixed, with #11083 (unreleased)    |                321 ms |               218 |               73% |                             936 |               201,794 |                  58% |

Where the runner's busiest Node process spends its CPU time (self time, by package):

- Vitest, browser, nomock (31.6 s busy): playwright-core 29%, node: internals 22%, (native) 13%, (gc) 9%, vite 9%, (program) 9%, rolldown 4%, @vitest/browser 2%
- Vitest, browser, mock (90.5 s busy): playwright-core 45%, vite 12%, (native) 12%, (gc) 11%, node: internals 11%, (program) 4%, rolldown 2%, @vitest/browser 1%
- Vite+ (`vp test`), browser, nomock (31.7 s busy): playwright-core 29%, node: internals 22%, @voidzero-dev/vite-plus-core 13%, (native) 13%, (gc) 9%, (program) 9%, @vitest/browser 2%, vitest 1%
- Vite+ (`vp test`), browser, mock (102.5 s busy): playwright-core 40%, @voidzero-dev/vite-plus-core 22%, (gc) 12%, (native) 11%, node: internals 10%, (program) 3%, @vitest/browser 1%, vitest 0%
- Rstest, browser, nomock (20.6 s busy): playwright-core 44%, node: internals 19%, (native) 18%, (gc) 8%, (program) 4%, @rsbuild/core 3%, @rstest/core 3%, @rstest/browser 1%
- Rstest, browser, mock (19.6 s busy): playwright-core 45%, node: internals 19%, (native) 17%, (gc) 7%, (program) 4%, @rsbuild/core 3%, @rstest/core 3%, @rstest/browser 1%
- `uf test`, browser, nomock (178.2 s busy): node: internals 100%, (native) 0%, (project) 0%, (gc) 0%
- Vitest, browser, mock, parallel hoisted imports (98.5 s busy): playwright-core 43%, vite 13%, (native) 12%, node: internals 12%, (gc) 11%, (program) 4%, rolldown 2%, @vitest/browser 1%
- Vitest, browser, mock, HTTP cache kept while routed (92.1 s busy): playwright-core 46%, (native) 12%, node: internals 12%, vite 11%, (gc) 11%, (program) 3%, rolldown 2%, @vitest/browser 1%
- Vitest, browser, mock, both (87.6 s busy): playwright-core 46%, (native) 12%, (gc) 11%, vite 11%, node: internals 11%, (program) 3%, rolldown 2%, @vitest/browser 1%
- Vitest, browser, mock, with #11083 (unreleased) (85.2 s busy): playwright-core 46%, (native) 12%, vite 12%, node: internals 11%, (gc) 11%, (program) 3%, rolldown 2%, @vitest/browser 1%
- Vitest, browser, mixed (60.5 s busy): playwright-core 41%, node: internals 14%, (native) 12%, vite 12%, (gc) 11%, (program) 4%, rolldown 3%, @vitest/browser 1%
- Vitest, browser, mixed, with #11083 (unreleased) (65.9 s busy): playwright-core 40%, (native) 15%, node: internals 14%, vite 11%, (gc) 11%, (program) 5%, rolldown 2%, @vitest/browser 1%

<details>
<summary>Machine and versions</summary>

- AMD EPYC 9V45 96-Core Processor, 2 logical CPUs, 8 GiB RAM, Linux 6.17.0-1022-azure (x64), toolchain from flake.nix, 2026-10-09
- every browser run launched the same Chromium (`chromium_headless_shell-1243`)
- Node v26.10.0, vitest 5.0.3, vite 8.3.4, vite-plus 1.1.0, vite-plus's vitest 5.0.3, vite-plus's core 1.1.0 (Vite 8.3.3), @rstest/core 0.12.3, jest 30.5.2, bun 1.4.2, deno 2.9.7, uf 0.36.0, playwright 1.63.0, chromium (headless shell) 153.0.8010.12, happy-dom 20.14.6

</details>

<!-- profile:end -->
