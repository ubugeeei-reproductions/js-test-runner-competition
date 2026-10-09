// Source rewrites that turn a "#host" test file into what each runner expects.

/**
 * Vitest only hoists `vi.mock()`, Rstest only `rs.mock()` and Jest only `jest.mock()` (each matches
 * the literal identifier), so for them "#host" is a compile-time macro rather than a runtime alias:
 *
 *   import { describe, host, it } from "#host";   →  import { describe, vi, it } from "vitest";
 *   host.mock("#src/x", …)                         →  vi.mock("#src/x", …)
 *
 * The result is exactly what a hand-written test for that runner looks like.
 */
export function renameHost(code: string, to: { module: string; name: string }): string | undefined {
  const importRe = /^(import\s*\{[^}]*)\bhost\b([^}]*\}\s*from\s*)["']#host["']/m;
  if (!importRe.test(code)) return undefined;
  return code.replace(importRe, `$1${to.name}$2"${to.module}"`).replace(/\bhost\./g, `${to.name}.`);
}

/**
 * Jest: `renameHost` to `jest`, plus `{ spy: true }`, for which `jest.mock` has no option. It
 * becomes the factory a Jest user writes for it: the real module with every function wrapped in
 * `jest.fn`.
 */
export function renameHostForJest(code: string): string | undefined {
  const renamed = renameHost(code, { module: "@jest/globals", name: "jest" });
  return renamed?.replace(
    /jest\.mock\(("[^"]+"), \{ spy: true \}\);/g,
    (_, path: string) =>
      `jest.mock(${path}, () => Object.fromEntries(Object.entries(jest.requireActual(${path})).map(([key, value]) => [key, typeof value === "function" ? jest.fn(value) : value])));`,
  );
}

/**
 * For runners that do not hoist module mocks (Node, uf): move the `host.mock()` calls above the
 * imports the way Vitest's hoisting does. The mocks are awaited first, then every static import
 * except "#host" becomes an `await import()`, one after another.
 */
export function hoistMocks(code: string): string {
  if (!code.includes("host.mock(")) return code;
  const importRe = /^import\s+\{([^}]*)\}\s+from\s+"([^"]+)";$/;
  const kept: string[] = [];
  const moved: string[] = [];
  for (const line of code.split("\n")) {
    const m = line.match(importRe);
    if (!m || m[2] === "#host") {
      kept.push(line.startsWith("host.mock(") ? `await ${line}` : line);
      continue;
    }
    const names = m[1]
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n && !n.startsWith("type "));
    moved.push(`const { ${names.join(", ")} } = await import("${m[2]}");`);
  }
  const at = kept.findIndex((l) => /^(afterEach|beforeEach|describe)\(/.test(l));
  kept.splice(at < 0 ? kept.length : at, 0, ...moved, "");
  return kept.join("\n");
}

export const isTestFile = (id: string) => id.split("?")[0].endsWith(".test.ts");
