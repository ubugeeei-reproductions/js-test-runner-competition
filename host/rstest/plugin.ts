// "#host" for Rstest: an Rsbuild plugin that rewrites test files to `rs` before the bundler
// (which implements Rstest's mock hoisting) parses them. See host/rewrite.ts.
import { renameHost } from "../rewrite.ts";

interface RsbuildTransformApi {
  transform(descriptor: { test: RegExp }, handler: (context: { code: string }) => string): void;
}

export function hostPlugin() {
  return {
    name: "repro:host",
    setup(api: RsbuildTransformApi) {
      api.transform(
        { test: /\.test\.ts$/ },
        ({ code }) => renameHost(code, { module: "@rstest/core", name: "rs" }) ?? code,
      );
    },
  };
}
