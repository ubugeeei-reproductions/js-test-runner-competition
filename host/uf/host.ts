// "#host" for `uf test`, selected by the "repro-uf" condition in package.json "imports"
// (host/uf/setup.ts and scripts/uf.ts pass `--conditions=repro-uf` to uf's Node workers).
//
// uf's `uft.mock()` is not hoisted and only affects imports that start after it, so
// host/uf/setup.ts hoists the mocks of each test file the way Vitest does.
import { afterEach, beforeEach, describe, expect, it, uft } from "@uniflowed/test";

export const host = {
  mock(
    path: string,
    factoryOrOptions: (() => Record<string, unknown>) | { spy: true },
  ): Promise<void> {
    if (typeof factoryOrOptions === "function") return uft.mock(path, factoryOrOptions);
    // { spy: true }: keep the real module, wrap every exported function in a spy.
    return uft.mock(path, async () => {
      const actual = (await uft.importActual(path)) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(actual).map(([k, v]) => [
          k,
          typeof v === "function" ? uft.fn(v as never) : v,
        ]),
      );
    });
  },
  fn: uft.fn,
};

export { afterEach, beforeEach, describe, expect, it };
