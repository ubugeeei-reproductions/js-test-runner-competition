// A Node module hook that applies `hoistMocks` (host/rewrite.ts) to test files as they load.
// Used by the runners whose `host.mock()` is not hoisted: `node --test` and `uf test`.
import { registerHooks } from "node:module";
import { hoistMocks, isTestFile } from "./rewrite.ts";

export function registerMockHoisting(): void {
  registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (!isTestFile(url) || result.source == null) return result;
      const code =
        typeof result.source === "string" ? result.source : new TextDecoder().decode(result.source);
      return { ...result, source: hoistMocks(code) };
    },
  });
}
