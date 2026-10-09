// Loaded into uf's Node workers: NODE_OPTIONS="--conditions=repro-uf --import=<this file>".
//
// - uf installs a DOM only for files that render through its React testing helpers, so tests get
//   a happy-dom window here, as with Bun's preload.
// - uf does not hoist module mocks; this load hook hoists them (host/rewrite.ts).
import { registerHooks } from "node:module";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { hoistMocks, isTestFile } from "../rewrite.ts";

GlobalRegistrator.register();

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!isTestFile(url) || result.source == null) return result;
    const code =
      typeof result.source === "string" ? result.source : new TextDecoder().decode(result.source);
    return { ...result, source: hoistMocks(code) };
  },
});
