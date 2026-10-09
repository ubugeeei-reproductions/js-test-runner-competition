#!/usr/bin/env node
// Runs every runner on both suites and prints comparison tables.
//
//   node scripts/bench.ts                      every runner × env × nomock / mock × isolate on / off
//   node scripts/bench.ts --repeat 3           more rounds (the median is reported)
//   node scripts/bench.ts --experiments        + Vitest with the experimental patches (see patches/)
//   node scripts/bench.ts --profile            + per-file request / route / event-loop stats (Vitest, vp)
//   node scripts/bench.ts --cpu-prof           + a V8 CPU profile of the runner's Node process
//   node scripts/bench.ts --runners vitest,rstest --envs browser --suites mock --isolate true
//
// Every runner gets the same number of parallel workers (`--workers`, default min(12, CPUs - 1),
// which is Vitest's and Rstest's own browser-mode default).
//
// Results go to results/<out>/ (runs.json, summary.md, logs/). `--readme <section>` also writes the
// summary into README.md between the `<!-- <section>:start -->` / `<!-- <section>:end -->` markers (CI).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { summarizeCpuProfile, type CpuProfileSummary } from "./cpuprofile.ts";
import { summarizeProfileDir, type ProfileSummary } from "./profile.ts";
import {
  defaultWorkers,
  invocation,
  LABEL,
  SUPPORT,
  supports,
  type Env,
  type Runner,
  type Suite,
} from "./runners.ts";
import { UF_VERSION } from "./uf.ts";

const cpus = os.availableParallelism();
const { values: args } = parseArgs({
  options: {
    runners: { type: "string", default: "vitest,vp,rstest,jest,bun,node,deno,uf" },
    envs: { type: "string", default: "browser,happy-dom" },
    suites: { type: "string", default: "nomock,mock" },
    isolate: { type: "string", default: "true,false" },
    workers: { type: "string", default: String(defaultWorkers()) },
    repeat: { type: "string", default: "1" },
    experiments: { type: "boolean", default: false },
    profile: { type: "boolean", default: false },
    "cpu-prof": { type: "boolean", default: false },
    readme: { type: "string" },
    "readme-file": { type: "string", default: "README.md" },
    out: { type: "string", default: "local" },
    "timeout-min": { type: "string", default: "30" },
  },
});
const WORKERS = Number(args.workers);

interface Case {
  id: string;
  runner: Runner;
  env: Env;
  suite: Suite;
  isolate: boolean;
  /** Experimental patch switches (see patches/). */
  experiment?: string;
  /** A sub-directory of the suite, e.g. "feature-00/"; the whole suite by default. */
  subset?: string;
  vars: Record<string, string>;
}

interface Run {
  case: string;
  round: number;
  wallSec: number;
  exitCode: number | null;
  passed?: number;
  failed?: number;
  /**
   * CPU time (user + sys) of the whole run and the part of it Chromium used. The total is the
   * larger of `time -p` (exact, but it only counts child processes that were waited for) and the
   * process tree sampled with `ps` twice a second (which misses processes shorter than that).
   */
  cpuSec: { total: number; browser: number };
  /** The Chromium executable(s) the run launched (browser runs). */
  browserExecutables?: string[];
  profile?: ProfileSummary;
  cpuProfile?: CpuProfileSummary;
}

const ROOT = new URL("..", import.meta.url).pathname;
const BIN = join(ROOT, "node_modules/.bin");
const OUT = join(ROOT, "results", args.out);
const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------
const caseId = (c: Pick<Case, "runner" | "env" | "suite" | "isolate" | "experiment">) =>
  `${c.env}/${c.runner}/${c.suite}/isolate=${c.isolate}${c.experiment ? `/${c.experiment}` : ""}`;
const cases: Case[] = [];
for (const env of list(args.envs) as Env[]) {
  for (const isolate of list(args.isolate).map((x) => x !== "false")) {
    for (const runner of list(args.runners) as Runner[]) {
      for (const suite of list(args.suites) as Suite[]) {
        if (!supports(runner, env, suite, isolate)) continue;
        const c = { runner, env, suite, isolate };
        cases.push({ ...c, id: caseId(c), vars: {} });
      }
    }
  }
}
// Extra cases, Vitest in a real browser with `isolate: true`: the experimental patches (patches/),
// and the mixed suite (every other file mocks), unpatched and with vitest-dev/vitest#11083, which
// was merged after 5.0.3 and keeps request interception on once a browser context saw a mock.
const EXPERIMENTS: Record<string, { label: string; vars: Record<string, string> }> = {
  "parallel-imports": {
    label: "parallel hoisted imports",
    vars: { REPRO_EXP_PARALLEL_IMPORTS: "1" },
  },
  "keep-cache": { label: "HTTP cache kept while routed", vars: { REPRO_EXP_KEEP_CACHE: "1" } },
  "parallel-imports+keep-cache": {
    label: "both",
    vars: { REPRO_EXP_PARALLEL_IMPORTS: "1", REPRO_EXP_KEEP_CACHE: "1" },
  },
  pr11083: { label: "with #11083 (unreleased)", vars: { REPRO_EXP_PR11083: "1" } },
};
if (args.experiments) {
  const extra: Array<[Suite, string | undefined]> = [
    ["mock", "parallel-imports"],
    ["mock", "keep-cache"],
    ["mock", "parallel-imports+keep-cache"],
    ["mock", "pr11083"],
    ["mixed", undefined],
    ["mixed", "pr11083"],
  ];
  for (const [suite, experiment] of extra) {
    const c = { runner: "vitest", env: "browser", suite, isolate: true, experiment } as const;
    cases.push({ ...c, id: caseId(c), vars: experiment ? EXPERIMENTS[experiment].vars : {} });
  }
}

// Inside `nix develop` these come from flake.nix; elsewhere from PATH (uf: a downloaded release).
const BUN = process.env.REPRO_BUN ?? "bun";
const DENO = process.env.REPRO_DENO ?? "deno";
const TIME = process.env.REPRO_TIME ?? "/usr/bin/time";
/** scripts/runners.ts's invocation, with commands resolved and the benchmark's own variables. */
function resolveCommand(
  c: Case,
  extraNodeOptions: string,
): { argv: string[]; env: Record<string, string> } {
  const inv = invocation({ ...c, workers: WORKERS });
  const [cmd, ...rest] = inv.argv;
  const resolved =
    cmd === "node"
      ? process.execPath
      : cmd === "bun"
        ? BUN
        : cmd === "deno"
          ? DENO
          : existsSync(join(BIN, cmd))
            ? join(BIN, cmd)
            : cmd;
  const env: Record<string, string> = { ...inv.env, ...c.vars, FORCE_COLOR: "0", NO_COLOR: "1" };
  // Playwright logs the executable it launches; recorded to show every runner used the same Chromium.
  if (c.env === "browser") env.DEBUG = [process.env.DEBUG, "pw:browser"].filter(Boolean).join(",");
  const nodeOptions = [process.env.NODE_OPTIONS, extraNodeOptions].filter(Boolean).join(" ");
  if (nodeOptions) env.NODE_OPTIONS = nodeOptions;
  return { argv: [resolved, ...rest], env };
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
/** Version of `name` as a direct dependency of the repo, or as a dependency of package `from`. */
function pkgVersion(name: string, from?: string): string {
  try {
    // pnpm: a package's own dependencies are its siblings in node_modules/.pnpm/<pkg>/node_modules
    const dir = from
      ? join(dirname(realpathSync(join(ROOT, "node_modules", from))), name)
      : join(ROOT, "node_modules", name);
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  } catch {
    return "?";
  }
}
function binVersion(bin: string, re: RegExp): string {
  try {
    return execFileSync(bin, ["--version"], { encoding: "utf8" }).match(re)?.[1] ?? "?";
  } catch {
    return "not installed";
  }
}
function vitePlusCore(): string {
  try {
    const dir = dirname(realpathSync(join(ROOT, "node_modules/vite-plus")));
    const core = JSON.parse(readFileSync(join(dir, "vite/package.json"), "utf8"));
    return `${core.version} (Vite ${core.bundledVersions?.vite ?? "?"})`;
  } catch {
    return "?";
  }
}
function chromiumVersion(): string {
  try {
    const dir = join(
      dirname(realpathSync(join(ROOT, "node_modules/playwright"))),
      "playwright-core",
    );
    const browsers: Array<{ name: string; browserVersion?: string }> = JSON.parse(
      readFileSync(join(dir, "browsers.json"), "utf8"),
    ).browsers;
    return browsers.find((b) => b.name === "chromium-headless-shell")?.browserVersion ?? "?";
  } catch {
    return "?";
  }
}
const environment = {
  date: new Date().toISOString(),
  machine:
    process.env.REPRO_MACHINE ??
    `${os.cpus()[0]?.model ?? "?"}, ${cpus} logical CPUs, ${Math.round(os.totalmem() / 2 ** 30)} GiB RAM`,
  os: `${os.type()} ${os.release()} (${os.arch()})`,
  /** Whether the toolchain came from flake.nix (`nix develop`). */
  pinned: process.env.REPRO_ENVIRONMENT === "nix",
  node: process.version,
  workers: WORKERS,
  versions: {
    vitest: pkgVersion("vitest"),
    vite: pkgVersion("vite"),
    "vite-plus": pkgVersion("vite-plus"),
    "vite-plus's vitest": pkgVersion("vitest", "vite-plus"),
    "vite-plus's core": vitePlusCore(),
    "@rstest/core": pkgVersion("@rstest/core"),
    jest: pkgVersion("jest"),
    bun: binVersion(BUN, /(\d+\.\d+\.\d+)/),
    deno: binVersion(DENO, /deno (\S+)/),
    uf: process.env.REPRO_UF ? binVersion(process.env.REPRO_UF, /uf (\S+)/) : UF_VERSION,
    playwright: pkgVersion("playwright"),
    "chromium (headless shell)": chromiumVersion(),
    "happy-dom": pkgVersion("happy-dom"),
  },
  fixture: JSON.parse(readFileSync(join(ROOT, "fixture/summary.json"), "utf8")) as {
    sourceModules: number;
    testFilesPerSuite: number;
    testCasesPerSuite: number;
    mockCallsInMockSuite: number;
  },
  loadAvgAtStart: os.loadavg().map((x) => +x.toFixed(2)),
};

// ---------------------------------------------------------------------------
// CPU sampling: cumulative CPU time of the run's process tree, sampled once a second.
// ---------------------------------------------------------------------------
function parseCpuTime(s: string): number {
  // ps "time" format: [[dd-]hh:]mm:ss[.ss]
  let days = 0;
  if (s.includes("-")) {
    const [d, rest] = s.split("-");
    days = Number(d);
    s = rest;
  }
  return days * 86400 + s.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
}
type Sample = Map<number, { browser: boolean; cpu: number; exe?: string }>;
function sampleTree(root: number, seen: Sample): void {
  let out: string;
  try {
    out = execFileSync("ps", ["-axo", "pid=,ppid=,time=,args="], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return;
  }
  const children = new Map<number, number[]>();
  const procs = new Map<number, { cpu: number; cmd: string }>();
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    procs.set(Number(m[1]), { cpu: parseCpuTime(m[3]), cmd: m[4] });
    const siblings = children.get(Number(m[2])) ?? [];
    siblings.push(Number(m[1]));
    children.set(Number(m[2]), siblings);
  }
  const stack = [root];
  while (stack.length) {
    const pid = stack.pop()!;
    const p = procs.get(pid);
    if (p) {
      const browser = /chrom|headless_shell/i.test(p.cmd);
      // the browser's main process: the executable, without a `--type=` (renderer, gpu, …)
      const first = p.cmd.split(" ")[0];
      const exe =
        browser && !p.cmd.includes("--type=") && first.startsWith("/") ? first : undefined;
      seen.set(pid, { browser, cpu: Math.max(p.cpu, seen.get(pid)?.cpu ?? 0), exe });
    }
    stack.push(...(children.get(pid) ?? []));
  }
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------
function runOnce(
  c: Case,
  round: number,
  logFile: string,
  extra: { vars?: Record<string, string>; nodeOptions?: string } = {},
): Promise<Run> {
  const { argv, env: vars } = resolveCommand(c, extra.nodeOptions ?? "");
  const env = { ...process.env, ...vars, ...extra.vars };
  const start = performance.now();
  const child = spawn(TIME, ["-p", ...argv], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const seen: Sample = new Map();
  const sampler = setInterval(() => sampleTree(child.pid!, seen), 500);
  const timeout = setTimeout(() => child.kill("SIGKILL"), Number(args["timeout-min"]) * 60_000);
  return new Promise((resolve) => {
    child.on("close", (code) => {
      const wallSec = (performance.now() - start) / 1000;
      clearInterval(sampler);
      clearTimeout(timeout);
      writeFileSync(logFile, output);
      let browser = 0;
      let sampled = 0;
      for (const p of seen.values()) {
        sampled += p.cpu;
        if (p.browser) browser += p.cpu;
      }
      const last = (re: RegExp) => Number([...output.matchAll(re)].at(-1)?.[1] ?? NaN);
      const timed = last(/^user\s+([\d.]+)$/gm) + last(/^sys\s+([\d.]+)$/gm);
      const total = Math.max(Number.isFinite(timed) ? timed : 0, sampled);
      const num = (...res: RegExp[]) => {
        for (const re of res) {
          const m = output.match(re);
          if (m) return Number(m[1]);
        }
        return undefined;
      };
      resolve({
        case: c.id,
        round,
        wallSec: +wallSec.toFixed(2),
        exitCode: code,
        // Vitest / vp / Rstest, Jest, Bun, Node, uf; Deno reports each `describe` as a test and its
        // `it`s (plus the `describe` itself) as steps.
        passed:
          c.runner === "deno"
            ? (([, describes, steps]) => Number(steps) - Number(describes))(
                output.match(/(\d+) passed \((\d+) steps\)/) ?? [],
              ) || undefined
            : num(
                /Tests\s+(?:\d+ failed \| )?(\d+) passed/,
                /Tests:\s+(?:\d+ failed, )?(\d+) passed/,
                /^\s*(\d+) pass$/m,
                /^ℹ pass (\d+)$/m,
                /^\s*passed\s+(\d+)$/m,
              ),
        failed:
          num(
            /Tests\s+(\d+) failed/,
            /Tests:\s+(\d+) failed/,
            /^\s*(\d+) fail$/m,
            /^ℹ fail (\d+)$/m,
            /^\s*failed\s+(\d+)$/m,
            /\| (\d+) failed/,
          ) ?? 0,
        cpuSec: { total: +total.toFixed(1), browser: +Math.min(browser, total).toFixed(1) },
        browserExecutables:
          c.env === "browser"
            ? [
                ...new Set([
                  ...[...output.matchAll(/<launching> (\S+)/g)].map((m) => m[1]),
                  ...[...seen.values()].flatMap((p) => (p.exe ? [p.exe] : [])),
                ]),
              ]
            : undefined,
      });
    });
  });
}

const ok = (r: Run) => r.exitCode === 0 && r.passed === environment.fixture.testCasesPerSuite;

async function main(): Promise<void> {
  if (!existsSync(join(ROOT, "fixture/summary.json"))) {
    console.log("fixture/ is missing, generating it first");
    execFileSync(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", join(ROOT, "scripts/generate.ts")],
      { stdio: "inherit" },
    );
  }
  if (cases.some((c) => c.env === "browser") && !process.env.PLAYWRIGHT_BROWSERS_PATH) {
    execFileSync(join(BIN, "playwright"), ["install", "chromium-headless-shell"], {
      stdio: "inherit",
    });
  }
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "logs"), { recursive: true });

  console.log(
    `machine: ${environment.machine}; load average ${environment.loadAvgAtStart.join(" / ")}; ${WORKERS} workers per runner`,
  );
  if (!environment.pinned) {
    console.warn(
      "note: not running inside `nix develop`; the toolchain is whatever this machine has",
    );
  }
  if (environment.loadAvgAtStart[0] > cpus / 2) {
    console.warn("warning: the machine is busy; wall-clock numbers will be inflated");
  }
  console.log(
    `versions: ${Object.entries(environment.versions)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
  );

  // Warm-up (not measured). Without a browser every suite runs once, because Jest and Deno keep
  // compiled files on disk and the first measured suite would otherwise warm them for the next.
  // With a browser one feature folder is enough: the runners keep transforms in memory, and it
  // fills Vite's dependency optimizer cache (and downloads uf if needed).
  const warmups = new Map(cases.map((c) => [`${c.env}/${c.runner}`, c]));
  for (const [key, c] of warmups) {
    const isolate = SUPPORT[c.runner].isolate[0];
    const suites = (["nomock", "mock", "mixed"] as const).filter((suite) =>
      supports(c.runner, c.env, suite, isolate),
    );
    const plan: Suite[] =
      c.env === "browser" ? [suites.includes("mock") ? "mock" : "nomock"] : suites;
    for (const suite of plan) {
      process.stdout.write(`warm-up ${key} ${suite} … `);
      const warm: Case = {
        ...c,
        id: `${key}/${suite}/warm-up`,
        suite,
        isolate,
        experiment: undefined,
        vars: {},
        subset: c.env === "browser" ? "feature-00/" : undefined,
      };
      const log = join(OUT, "logs", `${key.replace("/", "_")}-${suite}-warmup.log`);
      const r = await runOnce(warm, 0, log);
      console.log(`${r.wallSec}s (exit ${r.exitCode})`);
    }
  }

  const runs: Run[] = [];
  const rounds = Number(args.repeat);
  for (let round = 1; round <= rounds; round++) {
    // Rotate the order each round so no case always runs first / last.
    const order = cases.map((_, i) => cases[(i + round - 1) % cases.length]);
    for (const c of order) {
      const slug = c.id.replace(/[/:=+]/g, "_");
      const profDir = join(OUT, "profile", `${slug}-r${round}`);
      const profile =
        args.profile && c.env === "browser" && (c.runner === "vitest" || c.runner === "vp");
      const cpuProf = args["cpu-prof"] && c.runner !== "bun" && c.runner !== "deno";
      if (profile || cpuProf) rmSync(profDir, { recursive: true, force: true });
      process.stdout.write(`[${round}/${rounds}] ${c.id.padEnd(58)} `);
      const run = await runOnce(c, round, join(OUT, "logs", `${slug}-r${round}.log`), {
        vars: profile ? { REPRO_PROF_DIR: profDir } : {},
        nodeOptions: cpuProf ? `--cpu-prof --cpu-prof-dir=${join(profDir, "cpu")}` : "",
      });
      if (profile) run.profile = summarizeProfileDir(profDir);
      if (cpuProf) run.cpuProfile = summarizeCpuProfile(join(profDir, "cpu"));
      runs.push(run);
      // Written after every run, so a run that is cut short (CI time limit) still leaves results.
      save(runs, false);
      const status = ok(run)
        ? ""
        : `  !! exit ${run.exitCode}, ${run.passed ?? "?"} passed, see results/${args.out}/logs/${slug}-r${round}.log`;
      console.log(
        `${run.wallSec.toFixed(1).padStart(7)}s  CPU ${run.cpuSec.total}s (Chromium ${run.cpuSec.browser}s)${status}`,
      );
    }
  }

  console.log("\n" + save(runs, true));
  if (!runs.every(ok)) process.exitCode = 1;
}

/** Writes runs.json and summary.md (and the README section with `--readme`); returns the summary. */
function save(runs: Run[], complete: boolean): string {
  const result = {
    environment,
    complete,
    loadAvgAtEnd: os.loadavg().map((x) => +x.toFixed(2)),
    cases,
    runs,
  };
  writeFileSync(join(OUT, "runs.json"), JSON.stringify(result, null, 1) + "\n");
  const md = renderSummary(result);
  writeFileSync(join(OUT, "summary.md"), md);
  if (args.readme) updateReadme(args.readme, md);
  return md;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const fmt = (x: number, digits = 1) => (Number.isFinite(x) ? x.toFixed(digits) : "–");

/** "Vitest, mock, with #11083 (unreleased)" */
function caseName(id: string, cases: Case[]): string {
  const c = cases.find((x) => x.id === id);
  if (!c) return id;
  const parts = [LABEL[c.runner], c.suite];
  if (!c.isolate) parts.push("isolate: false");
  if (c.experiment) parts.push(EXPERIMENTS[c.experiment].label);
  return parts.join(", ");
}

function renderSummary(result: {
  environment: typeof environment;
  complete: boolean;
  cases: Case[];
  runs: Run[];
}): string {
  const runsOf = (id: string) => result.runs.filter((r) => r.case === id);
  const good = (id: string) => runsOf(id).filter(ok);
  const wall = (id: string) => median(good(id).map((r) => r.wallSec));
  const cpu = (id: string, k: "total" | "browser") => median(good(id).map((r) => r.cpuSec[k]));
  const total = (id: string) => cpu(id, "total");
  const cell = (id: string) => {
    if (runsOf(id).length === 0) return "–";
    return good(id).length < runsOf(id).length ? "failed" : `${fmt(wall(id))} s`;
  };
  const env = result.environment;
  const fx = env.fixture;
  const rounds = Math.max(...result.runs.map((r) => r.round));

  const lines: string[] = result.complete
    ? []
    : ["_Partial results: the benchmark did not finish._"];
  // A profiling run (--profile / --cpu-prof) reports only what it profiled.
  const profileOnly = result.runs.some((r) => r.profile || r.cpuProfile);
  const meta = [
    `${fx.testCasesPerSuite.toLocaleString("en-US")} tests in ${fx.testFilesPerSuite} files per suite`,
    `${fx.mockCallsInMockSuite.toLocaleString("en-US")} mocks in the mock suite`,
    `${env.workers} workers per runner`,
    `median of ${rounds} round${rounds > 1 ? "s" : ""}`,
  ];
  const base = profileOnly ? [] : result.cases.filter((c) => !c.experiment);

  if (!profileOnly) {
    // At a glance: each runner with its default isolation, the fastest of every column in bold.
    const defaultIsolation = (runner: Runner) => SUPPORT[runner].isolate[0];
    const glanceRunners = [...new Set(base.map((c) => c.runner))];
    const columns = (profileOnly ? [] : (["browser", "happy-dom"] as const))
      .flatMap((e) => (["nomock", "mock"] as const).map((suite) => ({ e, suite })))
      .filter(({ e }) => base.some((c) => c.env === e));
    const glanceId = (runner: Runner, e: Env, suite: Suite) =>
      caseId({ runner, env: e, suite, isolate: defaultIsolation(runner) });
    const best = columns.map(({ e, suite }) =>
      Math.min(...glanceRunners.map((r) => wall(glanceId(r, e, suite))).filter(Number.isFinite)),
    );
    lines.push(
      "",
      "Wall-clock time of the whole run, each runner with its default isolation.",
      "**Bold**: the fastest in its column. **(×N)**: what the mocks cost that runner.",
      "",
      `| Runner | ${columns.map(({ e, suite }) => `${e === "browser" ? "Browser" : "happy-dom"}, ${suite === "mock" ? "with mocks" : "no mocks"}`).join(" | ")} |`,
      `| --- | ${columns.map(() => "---:").join(" | ")} |`,
    );
    for (const runner of glanceRunners) {
      const cells = columns.map(({ e, suite }, i) => {
        if (!SUPPORT[runner].envs.includes(e)) return "–";
        const reason =
          suite === "mock" ? SUPPORT[runner].noMocks?.(defaultIsolation(runner), e) : undefined;
        if (reason) return `n/a`;
        const id = glanceId(runner, e, suite);
        if (runsOf(id).length === 0) return "–";
        if (good(id).length < runsOf(id).length) return "failed";
        const time = `${fmt(wall(id))} s`;
        const shown = wall(id) === best[i] ? `**${time}**` : time;
        const ratio = wall(id) / wall(glanceId(runner, e, "nomock"));
        return suite === "mock" && Number.isFinite(ratio)
          ? `${shown} (×${ratio.toFixed(2)})`
          : shown;
      });
      lines.push(`| ${LABEL[runner]} | ${cells.join(" | ")} |`);
    }
    const notes = glanceRunners.flatMap((runner) =>
      SUPPORT[runner].envs.flatMap((e) => {
        const reason = SUPPORT[runner].noMocks?.(defaultIsolation(runner), e);
        return reason ? [`${LABEL[runner]} (${e}): ${reason}`] : [];
      }),
    );
    lines.push(
      "",
      `<sub>${meta.join(" · ")}${notes.length ? `<br>n/a: ${notes.join("; ")}` : ""}</sub>`,
    );

    lines.push("", "<details>", "<summary>Every run: isolation on and off, CPU time</summary>");
    for (const e of ["browser", "happy-dom"] as const) {
      const keys = [
        ...new Set(base.filter((c) => c.env === e).map((c) => `${c.runner}|${c.isolate}`)),
      ];
      if (!keys.length) continue;
      lines.push(
        "",
        e === "browser"
          ? "**In a real browser** (Playwright's headless Chromium):"
          : "**In happy-dom** (no browser; every runner uses the same happy-dom):",
        "",
        `| Runner | isolate | no mocks | with mocks | mocks cost | CPU, no mocks → mocks${e === "browser" ? " (of which Chromium)" : ""} |`,
        "| --- | --- | ---: | ---: | ---: | ---: |",
      );
      for (const key of keys) {
        const [runner, isolate] = key.split("|") as [Runner, string];
        const a = caseId({ runner, env: e, suite: "nomock", isolate: isolate === "true" });
        const b = caseId({ runner, env: e, suite: "mock", isolate: isolate === "true" });
        const ratio = wall(b) / wall(a);
        const cpuCell =
          e === "browser"
            ? `${fmt(total(a))} → ${fmt(total(b))} s (${fmt(cpu(a, "browser"))} → ${fmt(cpu(b, "browser"))} s)`
            : `${fmt(total(a))} → ${fmt(total(b))} s`;
        const cost = Number.isFinite(ratio) ? `**×${ratio.toFixed(2)}**` : "–";
        const noMocks = SUPPORT[runner].noMocks?.(isolate === "true", e);
        lines.push(
          `| ${LABEL[runner]} | ${isolate} | ${cell(a)} | ${noMocks ? `n/a (${noMocks})` : cell(b)} | ${cost} | ${cpuCell} |`,
        );
      }
    }

    lines.push("", "</details>");
  }

  const extra = profileOnly ? [] : result.cases.filter((c) => c.experiment || c.suite === "mixed");
  if (extra.length) {
    const vitest = (suite: Suite, experiment?: string) =>
      caseId({ runner: "vitest", env: "browser", suite, isolate: true, experiment });
    lines.push(
      "",
      "<details>",
      "<summary>Vitest in a browser: the mixed suite, and the experimental patches</summary>",
      "",
      "| Suite | Variant | time | vs. unpatched | CPU (of which Chromium) |",
      "| --- | --- | ---: | ---: | ---: |",
    );
    const rows: Array<[Suite, string | undefined]> = [
      ["nomock", undefined],
      ["mixed", undefined],
      ...extra
        .filter((c) => c.suite === "mixed" && c.experiment)
        .map((c) => [c.suite, c.experiment] as [Suite, string]),
      ["mock", undefined],
      ...extra
        .filter((c) => c.suite === "mock")
        .map((c) => [c.suite, c.experiment] as [Suite, string]),
    ];
    for (const [suite, experiment] of rows) {
      const id = vitest(suite, experiment);
      const delta = wall(id) / wall(vitest(suite)) - 1;
      const vs =
        !experiment || !Number.isFinite(delta)
          ? "–"
          : `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(0)}%`;
      const label = experiment ? EXPERIMENTS[experiment].label : "unpatched";
      lines.push(
        `| ${suite} | ${label} | ${cell(id)} | ${vs} | ${fmt(total(id))} s (${fmt(cpu(id, "browser"))} s) |`,
      );
    }
  }

  if (extra.length) lines.push("", "</details>");

  const profiled = result.runs.filter((r) => r.profile && r.round === 1);
  if (profiled.length) {
    lines.push(
      "",
      "Per test file, unless noted:",
      "",
      "| Run | test file import, p50 | requests per file | answered with 304 | `context.route()` registrations | route predicate calls | Node event loop busy |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const r of profiled) {
      const p = r.profile!;
      lines.push(
        `| ${caseName(r.case, result.cases)} | ${fmt(p.importMsP50, 0)} ms | ${fmt(p.requestsPerFile, 0)} | ${fmt(p.http.share304 * 100, 0)}% | ` +
          `${p.routes.registers.toLocaleString("en-US")} | ${p.routes.predicateCalls.toLocaleString("en-US")} | ${fmt(p.node.meanElu * 100, 0)}% |`,
      );
    }
  }
  const cpuProfiled = result.runs.filter((r) => r.cpuProfile && r.round === 1);
  if (cpuProfiled.length) {
    lines.push(
      "",
      "Where the runner's busiest Node process spends its CPU time (self time, by package):",
      "",
    );
    for (const r of cpuProfiled) {
      const top = r
        .cpuProfile!.byPackage.slice(0, 8)
        .map((p) => `${p.name} ${fmt(p.share * 100, 0)}%`)
        .join(", ");
      lines.push(
        `- ${caseName(r.case, result.cases)} (${fmt(r.cpuProfile!.busySec)} s busy): ${top}`,
      );
    }
  }

  const executables = new Map<string, Set<string>>();
  for (const r of result.runs) {
    for (const exe of r.browserExecutables ?? []) {
      const runner = r.case.split("/")[1];
      executables.set(exe, (executables.get(exe) ?? new Set()).add(LABEL[runner as Runner]));
    }
  }
  const chromium =
    executables.size === 1
      ? `every browser run launched the same Chromium (\`${[...executables.keys()][0].replace(/^.*\/(chromium[^/]*)\/.*$/, "$1")}\`)`
      : undefined;
  if (executables.size > 1) {
    lines.push("", "**Warning: browser runs launched different Chromium executables:**", "");
    for (const [exe, runners] of executables)
      lines.push(`- \`${exe}\`: ${[...runners].join(", ")}`);
  }

  lines.push(
    "",
    "<details>",
    "<summary>Machine and versions</summary>",
    "",
    `- ${env.machine}, ${env.os}${env.pinned ? ", toolchain from flake.nix" : ""}, ${env.date.slice(0, 10)}`,
    ...(chromium ? [`- ${chromium}`] : []),
    `- Node ${env.node}, ${Object.entries(env.versions)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
    "",
    "</details>",
    "",
  );
  return lines.join("\n");
}

function updateReadme(section: string, md: string): void {
  const path = join(ROOT, args["readme-file"]);
  const readme = readFileSync(path, "utf8");
  const start = `<!-- ${section}:start -->`;
  const end = `<!-- ${section}:end -->`;
  const i = readme.indexOf(start);
  const j = readme.indexOf(end);
  if (i < 0 || j < 0) throw new Error(`${args["readme-file"]} has no ${section} markers`);
  writeFileSync(path, `${readme.slice(0, i + start.length)}\n\n${md.trim()}\n\n${readme.slice(j)}`);
}

await main();
