// Summarises what the profiling patches (patches/, enabled by REPRO_PROF_DIR) wrote for one run.
//
//   browser-<pid>.jsonl  one record per test file import, from the browser's Resource Timing
//   playwright-<pid>.json  route registrations and predicate evaluations (vi.mock interception)
//   node-<pid>.json      what the dev server answered (200 / 304) and Node main-thread
//                        event loop utilization, sampled once a second
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface ImportRecord {
  file: string;
  mode: string;
  importMs: number;
  requests: number;
  byClass: Record<string, number>;
  memoryCache: number;
  networkBusyMs: number;
}

interface RouteStats {
  registers: number;
  registersByType: Record<string, number>;
  predicateCalls: number;
  predicateMatched: number;
  predicateMs: number;
  handlerCalls: number;
  ops: Record<string, { n: number; totalMs: number; maxMs: number }>;
}

export interface ProfileSummary {
  files: number;
  importMsP50: number;
  importMsP90: number;
  requestsPerFile: number;
  /** Requests answered from the browser's memory cache (never reached the server). */
  memoryCacheShare: number;
  networkBusyMsP50: number;
  /** Server side: how many requests were conditional and how many got a 304. */
  http: { requests: number; conditional: number; status: Record<string, number>; share304: number };
  requestsPerFileByClass: Record<string, number>;
  routes: RouteStats;
  node: { seconds: number; meanElu: number; secondsAbove90PercentBusy: number };
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
};

export function summarizeProfileDir(dir: string): ProfileSummary | undefined {
  if (!existsSync(dir)) return undefined;
  const names = readdirSync(dir);
  const imports: ImportRecord[] = names
    .filter((n) => n.startsWith("browser-") && n.endsWith(".jsonl"))
    .flatMap((n) =>
      readFileSync(join(dir, n), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as ImportRecord),
    )
    .filter((r) => r.mode === "collect");
  const routes: RouteStats = {
    registers: 0,
    registersByType: {},
    predicateCalls: 0,
    predicateMatched: 0,
    predicateMs: 0,
    handlerCalls: 0,
    ops: {},
  };
  for (const n of names.filter((n) => n.startsWith("playwright-"))) {
    const r = JSON.parse(readFileSync(join(dir, n), "utf8")) as RouteStats;
    routes.registers += r.registers;
    routes.predicateCalls += r.predicateCalls;
    routes.predicateMatched += r.predicateMatched;
    routes.predicateMs += r.predicateMs;
    routes.handlerCalls += r.handlerCalls;
    for (const [k, v] of Object.entries(r.registersByType))
      routes.registersByType[k] = (routes.registersByType[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.ops)) {
      const o = (routes.ops[k] ??= { n: 0, totalMs: 0, maxMs: 0 });
      o.n += v.n;
      o.totalMs += v.totalMs;
      o.maxMs = Math.max(o.maxMs, v.maxMs);
    }
  }
  const nodeFile = names.find((n) => n.startsWith("node-"));
  const nodeData = nodeFile ? JSON.parse(readFileSync(join(dir, nodeFile), "utf8")) : undefined;
  const node = nodeData
    ? {
        seconds: nodeData.seconds,
        meanElu: nodeData.meanElu,
        secondsAbove90PercentBusy: nodeData.secondsAbove90PercentBusy,
      }
    : { seconds: 0, meanElu: NaN, secondsAbove90PercentBusy: 0 };
  const status: Record<string, number> = nodeData?.http?.status ?? {};
  const answered = Object.values(status).reduce((a, n) => a + n, 0);
  const http = {
    requests: nodeData?.http?.requests ?? 0,
    conditional: nodeData?.http?.conditional ?? 0,
    status,
    share304: (status["304"] ?? 0) / Math.max(1, answered),
  };

  const total = imports.reduce((a, r) => a + r.requests, 0);
  const byClass: Record<string, number> = {};
  for (const r of imports)
    for (const [k, v] of Object.entries(r.byClass)) byClass[k] = (byClass[k] ?? 0) + v;
  for (const k of Object.keys(byClass))
    byClass[k] = +(byClass[k] / Math.max(1, imports.length)).toFixed(1);
  return {
    files: imports.length,
    importMsP50: quantile(
      imports.map((r) => r.importMs),
      0.5,
    ),
    importMsP90: quantile(
      imports.map((r) => r.importMs),
      0.9,
    ),
    requestsPerFile: total / Math.max(1, imports.length),
    memoryCacheShare: imports.reduce((a, r) => a + r.memoryCache, 0) / Math.max(1, total),
    networkBusyMsP50: quantile(
      imports.map((r) => r.networkBusyMs),
      0.5,
    ),
    requestsPerFileByClass: byClass,
    http,
    routes,
    node,
  };
}
