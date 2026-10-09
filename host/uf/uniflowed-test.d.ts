// @uniflowed/test is Flow-typed and ships no TypeScript declarations; this is the part host/uf/host.ts uses.
declare module "@uniflowed/test" {
  export const describe: (name: string, body: () => void) => void;
  export const it: (name: string, body: () => unknown) => void;
  export const afterEach: (body: () => unknown) => void;
  export const beforeEach: (body: () => unknown) => void;
  export const expect: (value: unknown) => any;
  export const uft: {
    mock(specifier: string, factory: () => unknown): Promise<void>;
    importActual(specifier: string): Promise<unknown>;
    fn<T extends (...args: never[]) => unknown>(implementation?: T): T;
  };
}
