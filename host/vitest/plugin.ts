// "#host" for Vitest and Vite+ (`vp test`): a Vite plugin that rewrites test files to `vi`
// before Vitest's mock hoisting runs. See host/rewrite.ts.
import { isTestFile, renameHost } from "../rewrite.ts";

export function hostPlugin() {
  return {
    name: "repro:host",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (!isTestFile(id)) return undefined;
      const out = renameHost(code, { module: "vitest", name: "vi" });
      return out === undefined ? undefined : { code: out, map: null };
    },
  };
}
