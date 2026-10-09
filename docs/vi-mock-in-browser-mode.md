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

_Not measured yet._

<!-- profile:end -->
