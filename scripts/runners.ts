// How each runner is invoked, shared by the benchmark (scripts/bench.ts) and the `vpr` tasks
// (vite.config.ts), so that `vpr vitest:browser:mock` runs exactly what the benchmark measures.
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";

export type Runner = "vitest" | "vp" | "rstest" | "jest" | "bun" | "node" | "deno" | "uf";
export type Env = "browser" | "happy-dom";
export type Suite = "nomock" | "mock" | "mixed";

export const RUNNERS: Runner[] = ["vitest", "vp", "rstest", "jest", "bun", "node", "deno", "uf"];
export const ENVS: Env[] = ["browser", "happy-dom"];
export const SUITES: Suite[] = ["nomock", "mock", "mixed"];

export const LABEL: Record<Runner, string> = {
  vitest: "Vitest",
  vp: "Vite+ (`vp test`)",
  rstest: "Rstest",
  jest: "Jest",
  bun: "`bun test`",
  node: "`node --test`",
  deno: "`deno test`",
  uf: "`uf test`",
};

/** What each runner can be asked to do. */
export interface Support {
  envs: Env[];
  isolate: boolean[];
  /** Why the suites with mocks are not run, if they are not. */
  noMocks?: (isolate: boolean, env: Env) => string | undefined;
}

export const SUPPORT: Record<Runner, Support> = {
  vitest: { envs: ["browser", "happy-dom"], isolate: [true, false] },
  vp: { envs: ["browser", "happy-dom"], isolate: [true, false] },
  rstest: { envs: ["browser", "happy-dom"], isolate: [true, false] },
  // Jest always gives every test file a fresh module registry.
  jest: { envs: ["happy-dom"], isolate: [true] },
  // `bun test` has no browser mode. isolate: `--parallel` (isolated workers) / `--no-isolate`.
  bun: { envs: ["happy-dom"], isolate: [true, false] },
  // isolate: `--test-isolation=process` / `none`. Without isolation a module mock registered by one
  // file is still registered for the next ("The module is already mocked").
  node: {
    envs: ["happy-dom"],
    isolate: [true, false],
    noMocks: (isolate) => (isolate ? undefined : "mocks persist across files"),
  },
  // `deno test` has no module mocking, and runs every test file in a worker of its own.
  deno: { envs: ["happy-dom"], isolate: [true], noMocks: () => "no module mocking" },
  // uf resets the module registry between files. `uf test --browser` cannot mock modules, and it
  // serves only JavaScript with relative imports, so it runs the JavaScript copy of the suite
  // (fixture/js/, types stripped; see scripts/generate.ts).
  uf: {
    envs: ["browser", "happy-dom"],
    isolate: [true],
    noMocks: (_, env) => (env === "browser" ? "`--browser` cannot mock modules" : undefined),
  },
};

export const supports = (runner: Runner, env: Env, suite: Suite, isolate: boolean) =>
  SUPPORT[runner].envs.includes(env) &&
  SUPPORT[runner].isolate.includes(isolate) &&
  (suite === "nomock" || !SUPPORT[runner].noMocks?.(isolate, env));

/** Vitest's and Rstest's own browser-mode default: min(12, CPUs - 1). */
export const defaultWorkers = () => Math.max(1, Math.min(12, os.availableParallelism() - 1));

export interface Invocation {
  runner: Runner;
  env: Env;
  suite: Suite;
  isolate: boolean;
  workers: number;
  /** A sub-directory of the suite, e.g. "feature-00/". */
  subset?: string;
}

const ROOT = new URL("..", import.meta.url).pathname;

/** The test directory of an invocation. uf's browser mode runs the JavaScript copy. */
export function testDir({ runner, env, suite, subset = "" }: Invocation): string {
  const base = runner === "uf" && env === "browser" ? "fixture/js/tests" : "fixture/tests";
  return `${base}/${suite}/${subset}`;
}

/**
 * The command line (argv, with bare command names) and environment variables of an invocation.
 * Commands from node_modules/.bin are bare names; the benchmark resolves them to absolute paths.
 */
export function invocation(inv: Invocation): { argv: string[]; env: Record<string, string> } {
  const { runner, env, isolate } = inv;
  const w = String(inv.workers);
  const dir = testDir(inv);
  const vars: Record<string, string> = { REPRO_ENV: env, REPRO_ISOLATE: String(isolate) };
  switch (runner) {
    case "vitest":
      return {
        argv: ["vitest", "run", "--config", "vitest.config.ts", `--maxWorkers=${w}`, dir],
        env: vars,
      };
    case "vp":
      return {
        argv: ["vp", "test", "run", "--config", "vite.config.ts", `--maxWorkers=${w}`, dir],
        env: vars,
      };
    case "rstest":
      return {
        argv: [
          "rstest",
          "run",
          "--config",
          "rstest.config.ts",
          "--reporter",
          "default",
          "--pool.maxWorkers",
          w,
          dir,
        ],
        env: vars,
      };
    case "jest":
      return { argv: ["jest", "--config", "jest.config.ts", `--maxWorkers=${w}`, dir], env: vars };
    case "bun":
      return {
        argv: ["bun", "test", `--parallel=${w}`, ...(isolate ? [] : ["--no-isolate"]), `./${dir}`],
        env: vars,
      };
    case "node":
      return {
        argv: [
          "node",
          "--test",
          "--experimental-test-module-mocks",
          "--conditions=repro-node",
          "--import=./host/node/setup.ts",
          `--test-isolation=${isolate ? "process" : "none"}`,
          `--test-concurrency=${w}`,
          "--test-reporter=spec",
          `${dir}**/*.test.ts`,
        ],
        env: vars,
      };
    case "deno":
      return {
        argv: [
          "deno",
          "test",
          "-A",
          "--no-check",
          "--parallel",
          "--preload=./host/deno/setup.ts",
          dir,
        ],
        env: { ...vars, DENO_JOBS: w },
      };
    case "uf":
      // scripts/uf.ts: the pinned uf, with host/uf/setup.ts in its Node workers (not with --browser)
      return {
        argv: [
          "node",
          "scripts/uf.ts",
          "test",
          ...(env === "browser" ? ["--browser"] : []),
          "--color",
          "never",
          "-j",
          w,
          dir,
        ],
        env:
          env === "browser"
            ? {
                ...vars,
                // the same Chromium as Playwright's, with Playwright's --no-sandbox (host/uf/chromium.sh)
                UF_BROWSER: join(ROOT, "host/uf/chromium.sh"),
                REPRO_CHROMIUM: process.env.REPRO_CHROMIUM ?? chromiumHeadlessShell(),
              }
            : vars,
      };
  }
}

/** `invocation` as one shell command line, for `vpr` tasks. */
export function shellCommand(inv: Invocation): string {
  const { argv, env } = invocation(inv);
  const quote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);
  return [...Object.entries(env).map(([k, v]) => `${k}=${quote(v)}`), ...argv.map(quote)].join(" ");
}

/**
 * Playwright's headless Chromium (the one Vitest, Vite+ and Rstest launch), for uf's browser mode:
 * the Nix-built one inside `nix develop` (PLAYWRIGHT_BROWSERS_PATH), else Playwright's download.
 */
export function chromiumHeadlessShell(): string {
  const core = join(
    dirname(realpathSync(join(ROOT, "node_modules/playwright"))),
    "playwright-core",
  );
  const browsers: Array<{ name: string; revision: string }> = JSON.parse(
    readFileSync(join(core, "browsers.json"), "utf8"),
  ).browsers;
  const revision = browsers.find((b) => b.name === "chromium-headless-shell")?.revision;
  const cache =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    (process.platform === "darwin"
      ? join(os.homedir(), "Library/Caches/ms-playwright")
      : join(os.homedir(), ".cache/ms-playwright"));
  const dir = join(cache, `chromium_headless_shell-${revision}`);
  const platform = existsSync(dir)
    ? readdirSync(dir).find((d) => d.startsWith("chrome-headless-shell-"))
    : undefined;
  return platform ? join(dir, platform, "chrome-headless-shell") : "";
}

/** `vpr` tasks: `<runner>:<env>:<suite>`, and `<runner>:<env>` for its no-mock and mock suites. */
export function tasks(): Record<string, { command: string | string[]; cache: false }> {
  const isolate = process.env.REPRO_ISOLATE !== "false";
  const workers = Number(process.env.REPRO_WORKERS ?? defaultWorkers());
  const out: Record<string, { command: string | string[]; cache: false }> = {};
  for (const runner of RUNNERS) {
    // REPRO_ISOLATE=false applies to the runners that have that switch
    const iso = SUPPORT[runner].isolate.includes(isolate) ? isolate : SUPPORT[runner].isolate[0];
    for (const env of SUPPORT[runner].envs) {
      const runnable = SUITES.filter((suite) => supports(runner, env, suite, iso));
      for (const suite of runnable) {
        out[`${runner}:${env}:${suite}`] = {
          command: shellCommand({ runner, env, suite, isolate: iso, workers }),
          cache: false,
        };
      }
      if (runnable.length) {
        out[`${runner}:${env}`] = {
          command: runnable
            .filter((s) => s !== "mixed")
            .map((suite) => shellCommand({ runner, env, suite, isolate: iso, workers })),
          cache: false,
        };
      }
    }
  }
  return out;
}
