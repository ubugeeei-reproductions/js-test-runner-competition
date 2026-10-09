// "#host" for `bun test`, selected by the "bun" condition in package.json "imports".
//
// Bun's `mock.module()` is not hoisted, but it replaces the exports of a module in place, including
// for files that imported it already. So Bun needs no rewrite: `host` is a runtime object.
import { afterEach, beforeEach, describe, expect, it, jest, mock } from "bun:test";

export const host = {
  mock(path: string, factoryOrOptions: (() => Record<string, unknown>) | { spy: true }): void {
    if (typeof factoryOrOptions === "function") {
      void mock.module(path, factoryOrOptions);
      return;
    }
    // { spy: true }: keep the real module, wrap every exported function in a spy.
    const actual = require(path) as Record<string, unknown>;
    const spied = Object.fromEntries(
      Object.entries(actual).map(([k, v]) => [
        k,
        typeof v === "function" ? mock(v as (...args: never[]) => unknown) : v,
      ]),
    );
    void mock.module(path, () => spied);
  },
  fn: jest.fn,
};

export { afterEach, beforeEach, describe, expect, it };
