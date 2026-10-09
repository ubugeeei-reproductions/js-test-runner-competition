# One test file, eight runners

The test files never import a runner. They import `#host` instead:

```ts
import { afterEach, describe, expect, host, it } from "#host";
import { createListView } from "#src/features/feature-00/components/list-view";

host.mock("#src/app/context", () => ({ useAppContext: () => ({/* … */}) }));
host.mock("#src/ui/overlay/tooltip", { spy: true });
```

Each runner gets `#host` its own way. The code for each one lives in its own folder under
[`host/`](../host).

| Runner        | How `#host` reaches it                                 | Where                    |
| ------------- | ------------------------------------------------------ | ------------------------ |
| Vitest, Vite+ | rewritten to `vitest` / `vi.` at compile time          | `host/vitest/plugin.ts`  |
| Rstest        | rewritten to `@rstest/core` / `rs.` at compile time    | `host/rstest/plugin.ts`  |
| Jest          | rewritten to `@jest/globals` / `jest.` at compile time | `host/jest/transform.ts` |
| Bun           | the `"bun"` condition in package.json                  | `host/bun/`              |
| Node          | the `"repro-node"` condition                           | `host/node/`             |
| Deno          | the `"deno"` condition                                 | `host/deno/`             |
| uf            | the `"repro-uf"` condition                             | `host/uf/`               |

## Why rewrite for some runners?

Vitest, Rstest and Jest move their mock calls above the imports. But they only recognize their
own name: `vi.mock`, `rs.mock`, `jest.mock`. So for them `#host` is renamed before anything else
runs, and they see exactly the test a person would write for them.

Jest has no `{ spy: true }`. It gets the `jest.requireActual` version a Jest user would write.

## And for the others?

- **Bun** doesn't move mocks up, but `mock.module()` also replaces modules that were already
  imported. A plain object is enough.
- **Node and uf** don't move mocks up either, and their mocks only affect later imports. A small
  loader hook does what Vitest does: run the mocks first, then the imports, one by one
  (`host/hoisting-hook.ts`).

## Imports

Source files are imported through package.json subpath imports: `#src/app/context` is
`./fixture/src/app/context.ts`. Relative imports spell out `.ts`. No runner needs alias settings,
and Node and Deno load the files as they are.

## uf in the browser

`uf test --browser` only serves JavaScript, and doesn't resolve package.json `imports` in the page.

So it runs `fixture/js/`: the same source and `nomock` suite, with the types stripped
(`node:module`'s `stripTypeScriptTypes`) and the `#…` imports made relative. The code is otherwise
the same. uf also skips the TypeScript transform the other browser runners do, which works slightly
in its favor.

It also needs `@uniflowed/host` as a direct dependency: `@uniflowed/test` imports it in the page,
and pnpm doesn't expose it otherwise.

## Files

```
flake.nix          the pinned toolchain
host/              #host, one folder per runner
scripts/
  generate.ts      writes fixture/ (always the same)
  runners.ts       how each runner is started, for the benchmark and the vpr tasks
  bench.ts         runs everything, measures time and CPU, writes results/
  profile.ts       reads what the profiling patches wrote
  cpuprofile.ts    reads V8 CPU profiles
  uf.ts            starts uf (downloads it when not inside Nix)
patches/           profiling patches
*.config.ts        one per runner; vite.config.ts also has the vpr tasks
```
