// "#host" for `node --test`, selected by the "repro-node" condition in package.json "imports".
//
// `mock.module()` (still behind --experimental-test-module-mocks) is not hoisted and only affects
// imports that start after it, so host/node/setup.ts hoists the mocks of each test file.
// Assertions come from `expect`, Jest's matcher library, since `node:test` has none of its own.
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { expect } from "expect";

export const host = {
  async mock(
    path: string,
    factoryOrOptions: (() => Record<string, unknown>) | { spy: true },
  ): Promise<void> {
    if (typeof factoryOrOptions === "function") {
      mock.module(path, { exports: factoryOrOptions() });
      return;
    }
    // { spy: true }: keep the real module, wrap every exported function in a spy.
    const actual = (await import(path)) as Record<string, unknown>;
    const spied = Object.fromEntries(
      Object.entries(actual).map(([k, v]) => [
        k,
        typeof v === "function" ? mock.fn(v as (...args: never[]) => unknown) : v,
      ]),
    );
    mock.module(path, { exports: spied });
  },
  fn: <T extends (...args: never[]) => unknown>(implementation?: T) => mock.fn(implementation),
};

export { afterEach, beforeEach, describe, expect, it };
