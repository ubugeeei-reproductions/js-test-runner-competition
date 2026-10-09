#!/usr/bin/env node
// `uf` (https://github.com/ubugeeei-prod/uf) is a native binary that is not published to npm.
// This downloads the pinned release on first use into node_modules/.cache/uf/<version>/, after
// checking it against the SHA-256 the release publishes, and runs it:
//
//   node scripts/uf.ts test fixture/tests/mock/
//
// Like the benchmark, it runs uf's Node workers with host/uf/setup.ts (see that file for why).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const UF_VERSION = "0.36.0";

const TARGETS: Record<string, string> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
};

const ROOT = new URL("..", import.meta.url).pathname;

/** NODE_OPTIONS for uf's Node workers: the "#host" condition and host/uf/setup.ts. */
export function ufNodeOptions(): string {
  return `--conditions=repro-uf --import=${pathToFileURL(join(ROOT, "host/uf/setup.ts")).href}`;
}

export async function ensureUf(): Promise<string> {
  const dir = join(ROOT, "node_modules/.cache/uf", UF_VERSION);
  const bin = join(dir, "bin/uf");
  if (existsSync(bin)) return bin;
  const target = TARGETS[`${process.platform}-${process.arch}`];
  if (!target) throw new Error(`no uf release for ${process.platform}-${process.arch}`);
  const url = `https://github.com/ubugeeei-prod/uf/releases/download/uf%40${UF_VERSION}/uf-${target}.tar.gz`;
  console.log(`downloading uf ${UF_VERSION} (${target})`);
  const [archive, digest] = await Promise.all([
    fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    }),
    fetch(`${url}.sha256`).then(async (r) => {
      if (!r.ok) throw new Error(`${url}.sha256: ${r.status}`);
      return (await r.text()).trim().split(/\s+/)[0];
    }),
  ]);
  const actual = createHash("sha256").update(archive).digest("hex");
  if (actual !== digest)
    throw new Error(`uf ${UF_VERSION}: SHA-256 mismatch (${actual} != ${digest})`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "uf.tar.gz"), archive);
  execFileSync("tar", ["xzf", "uf.tar.gz"], { cwd: dir });
  return bin;
}

if (import.meta.main) {
  const bin = await ensureUf();
  const result = spawnSync(bin, process.argv.slice(2), {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, ufNodeOptions()].filter(Boolean).join(" "),
    },
  });
  process.exit(result.status ?? 1);
}
