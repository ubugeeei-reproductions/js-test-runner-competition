
Per test file, unless noted:

| Run | test file import, p50 | requests per file | answered with 304 | `context.route()` registrations | route predicate calls | Node event loop busy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Vitest, nomock | 207 ms | 222 | 98% | 0 | 0 | 52% |
| Vitest, mock | 411 ms | 214 | 8% | 1,883 | 401,623 | 64% |
| Vite+ (`vp test`), nomock | 201 ms | 222 | 98% | 0 | 0 | 52% |
| Vite+ (`vp test`), mock | 428 ms | 214 | 9% | 1,883 | 401,622 | 66% |
| Vitest, mock, parallel hoisted imports | 418 ms | 214 | 8% | 1,883 | 401,615 | 66% |
| Vitest, mock, HTTP cache kept while routed | 356 ms | 214 | 98% | 1,883 | 401,683 | 65% |
| Vitest, mock, both | 335 ms | 214 | 98% | 1,883 | 401,644 | 66% |
| Vitest, mock, with #11083 (unreleased) | 335 ms | 214 | 74% | 1,883 | 401,601 | 65% |
| Vitest, mixed | 226 ms | 218 | 55% | 936 | 201,806 | 59% |
| Vitest, mixed, with #11083 (unreleased) | 321 ms | 218 | 73% | 936 | 201,794 | 58% |

Where the runner's busiest Node process spends its CPU time (self time, by package):

- Vitest, nomock (31.6 s busy): playwright-core 29%, node: internals 22%, (native) 13%, (gc) 9%, vite 9%, (program) 9%, rolldown 4%, @vitest/browser 2%
- Vitest, mock (90.5 s busy): playwright-core 45%, vite 12%, (native) 12%, (gc) 11%, node: internals 11%, (program) 4%, rolldown 2%, @vitest/browser 1%
- Vite+ (`vp test`), nomock (31.7 s busy): playwright-core 29%, node: internals 22%, @voidzero-dev/vite-plus-core 13%, (native) 13%, (gc) 9%, (program) 9%, @vitest/browser 2%, vitest 1%
- Vite+ (`vp test`), mock (102.5 s busy): playwright-core 40%, @voidzero-dev/vite-plus-core 22%, (gc) 12%, (native) 11%, node: internals 10%, (program) 3%, @vitest/browser 1%, vitest 0%
- Rstest, nomock (20.6 s busy): playwright-core 44%, node: internals 19%, (native) 18%, (gc) 8%, (program) 4%, @rsbuild/core 3%, @rstest/core 3%, @rstest/browser 1%
- Rstest, mock (19.6 s busy): playwright-core 45%, node: internals 19%, (native) 17%, (gc) 7%, (program) 4%, @rsbuild/core 3%, @rstest/core 3%, @rstest/browser 1%
- `uf test`, nomock (178.2 s busy): node: internals 100%, (native) 0%, (project) 0%, (gc) 0%
- Vitest, mock, parallel hoisted imports (98.5 s busy): playwright-core 43%, vite 13%, (native) 12%, node: internals 12%, (gc) 11%, (program) 4%, rolldown 2%, @vitest/browser 1%
- Vitest, mock, HTTP cache kept while routed (92.1 s busy): playwright-core 46%, (native) 12%, node: internals 12%, vite 11%, (gc) 11%, (program) 3%, rolldown 2%, @vitest/browser 1%
- Vitest, mock, both (87.6 s busy): playwright-core 46%, (native) 12%, (gc) 11%, vite 11%, node: internals 11%, (program) 3%, rolldown 2%, @vitest/browser 1%
- Vitest, mock, with #11083 (unreleased) (85.2 s busy): playwright-core 46%, (native) 12%, vite 12%, node: internals 11%, (gc) 11%, (program) 3%, rolldown 2%, @vitest/browser 1%
- Vitest, mixed (60.5 s busy): playwright-core 41%, node: internals 14%, (native) 12%, vite 12%, (gc) 11%, (program) 4%, rolldown 3%, @vitest/browser 1%
- Vitest, mixed, with #11083 (unreleased) (65.9 s busy): playwright-core 40%, (native) 15%, node: internals 14%, vite 11%, (gc) 11%, (program) 5%, rolldown 2%, @vitest/browser 1%

<details>
<summary>Machine and versions</summary>

- AMD EPYC 9V45 96-Core Processor, 2 logical CPUs, 8 GiB RAM, Linux 6.17.0-1022-azure (x64), toolchain from flake.nix, 2026-10-09
- every browser run launched the same Chromium (`chromium_headless_shell-1243`)
- Node v26.10.0, vitest 5.0.3, vite 8.3.4, vite-plus 1.1.0, vite-plus's vitest 5.0.3, vite-plus's core 1.1.0 (Vite 8.3.3), @rstest/core 0.12.3, jest 30.5.2, bun 1.4.2, deno 2.9.7, uf 0.36.0, playwright 1.63.0, chromium (headless shell) 153.0.8010.12, happy-dom 20.14.6

</details>
