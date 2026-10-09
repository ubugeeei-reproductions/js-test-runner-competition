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

_Not measured yet._

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
