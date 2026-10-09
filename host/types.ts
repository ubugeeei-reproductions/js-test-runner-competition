// The API test files get from "#host", for editors and `tsc` (package.json "imports" → "types").
//
// Nothing loads this file at run time. Each runner supplies "#host" in its own way:
//
//   Vitest, Vite+  host/vitest/plugin.ts  compile time: "#host" → "vitest", `host.` → `vi.`
//   Rstest         host/rstest/plugin.ts  compile time: "#host" → "@rstest/core", `host.` → `rs.`
//   Bun            host/bun/host.ts       run time, through the "bun" condition
//   uf             host/uf/host.ts        run time, through the "repro-uf" condition
//
// Only what every runner supports with the same meaning is part of it.
type Vitest = typeof import("vitest");

export declare const describe: Vitest["describe"];
export declare const it: Vitest["it"];
export declare const expect: Vitest["expect"];
export declare const beforeEach: Vitest["beforeEach"];
export declare const afterEach: Vitest["afterEach"];

export interface Host {
  /**
   * Replace a module with what a synchronous factory returns, or keep it and wrap every exported
   * function in a spy (`{ spy: true }`). Applies to the whole test file, as if written above its
   * imports.
   */
  mock(path: string, factory: () => Record<string, unknown>): void;
  mock(path: string, options: { spy: true }): void;
  /** A mock function. */
  fn: Vitest["vi"]["fn"];
}

export declare const host: Host;
