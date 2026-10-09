// Summarises V8 CPU profiles (node --cpu-prof) by package: which code the Node main thread runs.
// The largest profile in the directory is taken as the runner's main process.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

interface CpuProfile {
  nodes: Array<{ id: number; callFrame: { functionName: string; url: string } }>;
  samples: number[];
  timeDeltas: number[];
}

export interface CpuProfileSummary {
  file: string;
  busySec: number;
  byPackage: Array<{ name: string; sec: number; share: number }>;
}

function bucket(url: string, fn: string): string {
  if (!url) {
    if (fn === "(idle)") return "(idle)";
    if (fn === "(garbage collector)") return "(gc)";
    if (fn === "(program)") return "(program)";
    return "(native)";
  }
  if (url.startsWith("node:")) return "node: internals";
  const m = url.match(/node_modules\/(?!\.pnpm\/)((?:@[^/]+\/)?[^/]+)\/(?!.*node_modules\/)/);
  if (m) return m[1];
  return "(project)";
}

export function summarizeCpuProfile(dir: string): CpuProfileSummary | undefined {
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir).filter((f) => f.endsWith(".cpuprofile"));
  if (!files.length) return undefined;
  const largest = files
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).size - statSync(a).size)[0];
  const profile = JSON.parse(readFileSync(largest, "utf8")) as CpuProfile;
  const nodeBucket = new Map(
    profile.nodes.map((n) => [n.id, bucket(n.callFrame.url, n.callFrame.functionName)]),
  );
  const self = new Map<string, number>();
  profile.samples.forEach((id, i) => {
    const b = nodeBucket.get(id) ?? "(native)";
    self.set(b, (self.get(b) ?? 0) + (profile.timeDeltas[i] ?? 0));
  });
  const busyUs = [...self].filter(([k]) => k !== "(idle)").reduce((a, [, v]) => a + v, 0);
  const byPackage = [...self]
    .filter(([k]) => k !== "(idle)")
    .map(([name, us]) => ({ name, sec: +(us / 1e6).toFixed(1), share: us / busyUs }))
    .sort((a, b) => b.sec - a.sec);
  return { file: largest, busySec: busyUs / 1e6, byPackage };
}
