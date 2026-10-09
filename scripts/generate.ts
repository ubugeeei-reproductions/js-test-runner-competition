#!/usr/bin/env node
// Generates a synthetic "large frontend app" under fixture/.
//
// The shape mirrors a real-world app (design system + shared layer + many feature folders)
// whose browser-mode test suite became very slow once files started using module mocks:
//
//   fixture/src/ui/<package>/        9 design-system packages, each a barrel over ~24 components
//   fixture/src/shared/              api client + endpoints, stores, utils, i18n, validation
//   fixture/src/app/                 app context + router (the most commonly mocked modules)
//   fixture/src/features/<feature>/  api, store, composables, components, page
//   fixture/tests/nomock/<feature>/  test files without module mocks
//   fixture/tests/mock/<feature>/    the exact same test files plus `host.mock(...)` calls
//
// Test files import their runner API from "#host" and use `host.mock` / `host.fn` /
// `host.importActual`. Each runner config rewrites that to `vi.*` (Vitest, Vite+) or `rs.*`
// (Rstest) at compile time, so every runner executes byte-identical test sources.
//
// Usage: node scripts/generate.ts [--features 50] [--files-per-feature 10] [--tests-per-file 10]
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    features: { type: "string", default: "50" },
    "files-per-feature": { type: "string", default: "10" },
    "tests-per-file": { type: "string", default: "10" },
    out: { type: "string", default: "fixture" },
  },
});
const FEATURES = Number(args.features);
const FILES_PER_FEATURE = Math.min(Number(args["files-per-feature"]), 10);
const TESTS_PER_FILE = Number(args["tests-per-file"]);
// Written to a temporary directory and swapped in at the end, so that a concurrent run (say, the
// postinstall of a parallel `pnpm install`) can never leave a half-deleted fixture behind.
const DEST = args.out;
const OUT = `${DEST}.tmp-${process.pid}`;

// Deterministic PRNG so every machine generates the same project.
let seed = 0x5eed;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
function sample<T>(list: readonly T[], n: number): T[] {
  const copy = [...list];
  const out: T[] = [];
  while (out.length < n && copy.length)
    out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  return out;
}
const pascal = (s: string): string =>
  s.replace(/(^|-)(\w)/g, (_, __, c: string) => c.toUpperCase());
const camel = (s: string): string => s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

let fileCount = 0;
function write(path: string, content: string): void {
  const full = join(OUT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content.trimStart());
  fileCount++;
}

rmSync(OUT, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// Design system: 9 packages × (barrel + tokens + helpers + 24 components)
// ---------------------------------------------------------------------------
const UI_PACKAGES = [
  "core",
  "form",
  "table",
  "layout",
  "overlay",
  "navigation",
  "feedback",
  "data-display",
  "media",
];
const UI_NOUNS = [
  "button",
  "badge",
  "card",
  "chip",
  "field",
  "group",
  "header",
  "item",
  "label",
  "list",
  "menu",
  "panel",
  "row",
  "section",
  "slot",
  "stack",
  "tab",
  "tag",
  "tile",
  "toggle",
  "toolbar",
  "tooltip",
  "view",
  "well",
];
/** package -> exported factory names */
const uiExports: Record<string, string[]> = {};

write(
  "src/ui/core/dom.ts",
  `
export type Attrs = Record<string, string | number | boolean | null | undefined>;

export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, children: Array<Node | string> = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === "class") node.className = String(value);
    else if (key.startsWith("data-")) node.dataset[key.slice(5).replace(/-(\\w)/g, (_, c: string) => c.toUpperCase())] = String(value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

export function on<K extends keyof HTMLElementEventMap>(node: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void): () => void {
  node.addEventListener(type, handler);
  return () => node.removeEventListener(type, handler);
}
`,
);

for (const pkg of UI_PACKAGES) {
  const Pkg = pascal(pkg);
  write(
    `src/ui/${pkg}/tokens.ts`,
    `
export const ${camel(pkg)}Tokens = {
  space: [0, 2, 4, 8, 12, 16, 24, 32, 48],
  radius: { sm: 2, md: 4, lg: 8, pill: 999 },
  color: {
    fg: "#1f2328",
    muted: "#59636e",
    accent: "#0969da",
    danger: "#d1242f",
    success: "#1a7f37",
    surface: "#ffffff",
  },
  size: { sm: 24, md: 32, lg: 40 },
} as const;

export type ${Pkg}Size = keyof typeof ${camel(pkg)}Tokens.size;
export type ${Pkg}Tone = "neutral" | "accent" | "danger" | "success";

export function ${camel(pkg)}Space(step: number): string {
  const scale = ${camel(pkg)}Tokens.space;
  return \`\${scale[Math.max(0, Math.min(scale.length - 1, step))]}px\`;
}
`,
  );
  write(
    `src/ui/${pkg}/helpers.ts`,
    `
import type { ${Pkg}Size, ${Pkg}Tone } from "./tokens.ts";
import { ${camel(pkg)}Tokens } from "./tokens.ts";

export function ${camel(pkg)}ClassName(base: string, size: ${Pkg}Size, tone: ${Pkg}Tone, disabled: boolean): string {
  return [\`ds-${pkg}\`, \`ds-${pkg}--\${base}\`, \`is-\${size}\`, \`tone-\${tone}\`, disabled ? "is-disabled" : ""].filter(Boolean).join(" ");
}

export function ${camel(pkg)}Style(size: ${Pkg}Size, tone: ${Pkg}Tone): string {
  const color = tone === "neutral" ? ${camel(pkg)}Tokens.color.fg : ${camel(pkg)}Tokens.color[tone === "accent" ? "accent" : tone];
  return \`min-height:\${${camel(pkg)}Tokens.size[size]}px;color:\${color};border-radius:\${${camel(pkg)}Tokens.radius.md}px\`;
}

export function ${camel(pkg)}Label(text: string | undefined, fallback: string): string {
  const value = (text ?? "").trim();
  return value.length > 0 ? value : fallback;
}
`,
  );

  uiExports[pkg] = [];
  for (const noun of UI_NOUNS) {
    const name = `${pkg}-${noun}`;
    const Name = pascal(name);
    const factory = `create${Name}`;
    uiExports[pkg].push(factory);
    const steps = 3 + Math.floor(rand() * 4);
    const extraState = Array.from({ length: steps }, (_, i) => `  step${i}: number;`).join("\n");
    const extraInit = Array.from({ length: steps }, (_, i) => `step${i}: ${i}`).join(", ");
    write(
      `src/ui/${pkg}/${noun}.ts`,
      `
import { cx, el, on } from "${pkg === "core" ? "./dom.ts" : "../core/dom.ts"}";
import { ${camel(pkg)}ClassName, ${camel(pkg)}Label, ${camel(pkg)}Style } from "./helpers.ts";
import type { ${Pkg}Size, ${Pkg}Tone } from "./tokens.ts";

export interface ${Name}Props {
  label?: string;
  size?: ${Pkg}Size;
  tone?: ${Pkg}Tone;
  disabled?: boolean;
  items?: string[];
  onActivate?: (value: string) => void;
}

interface ${Name}State {
  active: number;
  expanded: boolean;
${extraState}
}

export const ${camel(Name)}Defaults: Required<Omit<${Name}Props, "onActivate">> = {
  label: "${Name}",
  size: "md",
  tone: "neutral",
  disabled: false,
  items: [],
};

function reduce${Name}(state: ${Name}State, action: { type: "activate"; index: number } | { type: "toggle" }): ${Name}State {
  switch (action.type) {
    case "activate":
      return { ...state, active: action.index };
    case "toggle":
      return { ...state, expanded: !state.expanded };
  }
}

export function ${factory}(props: ${Name}Props = {}): HTMLElement {
  const resolved = { ...${camel(Name)}Defaults, ...props };
  let state: ${Name}State = { active: -1, expanded: false, ${extraInit} };
  const root = el("div", {
    class: cx(${camel(pkg)}ClassName("${noun}", resolved.size, resolved.tone, resolved.disabled), state.expanded && "is-expanded"),
    style: ${camel(pkg)}Style(resolved.size, resolved.tone),
    role: "group",
    "aria-disabled": resolved.disabled,
    "data-ds": "${name}",
  });
  const title = el("span", { class: "ds-${pkg}__label" }, [${camel(pkg)}Label(resolved.label, "${Name}")]);
  const list = el("ul", { class: "ds-${pkg}__items" });
  resolved.items.forEach((item, index) => {
    const entry = el("li", { "data-index": index }, [item]);
    on(entry, "click", () => {
      if (resolved.disabled) return;
      state = reduce${Name}(state, { type: "activate", index });
      root.dataset.active = String(state.active);
      props.onActivate?.(item);
    });
    list.append(entry);
  });
  on(root, "keydown", (event) => {
    if (event.key === "Enter") {
      state = reduce${Name}(state, { type: "toggle" });
      root.classList.toggle("is-expanded", state.expanded);
    }
  });
  root.append(title, list);
  return root;
}
`,
    );
  }
  write(
    `src/ui/${pkg}.ts`,
    [
      `export * from "./${pkg}/tokens.ts";`,
      `export * from "./${pkg}/helpers.ts";`,
      ...(pkg === "core" ? [`export * from "./core/dom.ts";`] : []),
      ...UI_NOUNS.map((n) => `export * from "./${pkg}/${n}.ts";`),
      "",
    ].join("\n"),
  );
}
write("src/ui.ts", UI_PACKAGES.map((p) => `export * from "./ui/${p}.ts";`).join("\n") + "\n");

// ---------------------------------------------------------------------------
// Shared layer
// ---------------------------------------------------------------------------
const ENDPOINTS = Array.from({ length: 20 }, (_, i) => `endpoint-${String(i).padStart(2, "0")}`);
const STORES = Array.from({ length: 10 }, (_, i) => `store-${String(i).padStart(2, "0")}`);
const UTILS = Array.from({ length: 20 }, (_, i) => `util-${String(i).padStart(2, "0")}`);
const VALIDATORS = Array.from({ length: 6 }, (_, i) => `rule-${String(i).padStart(2, "0")}`);
const LOCALES = ["en", "de", "fr", "es"];

write(
  "src/shared/api/client.ts",
  `
// In-memory backend: the app never hits the network in tests.
export interface Page<T> {
  items: T[];
  total: number;
}

const db = new Map<string, Array<Record<string, unknown>>>();

function table(name: string): Array<Record<string, unknown>> {
  let rows = db.get(name);
  if (!rows) {
    rows = Array.from({ length: 5 }, (_, i) => ({ id: \`\${name}-\${i}\`, name: \`\${name} #\${i}\`, updatedAt: 1_700_000_000_000 + i }));
    db.set(name, rows);
  }
  return rows;
}

export const apiClient = {
  async list<T>(name: string, query: { offset?: number; limit?: number } = {}): Promise<Page<T>> {
    const rows = table(name);
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 20;
    return { items: rows.slice(offset, offset + limit) as T[], total: rows.length };
  },
  async get<T>(name: string, id: string): Promise<T | undefined> {
    return table(name).find((row) => row.id === id) as T | undefined;
  },
  async save<T extends { id: string }>(name: string, row: T): Promise<T> {
    const rows = table(name);
    const index = rows.findIndex((r) => r.id === row.id);
    if (index >= 0) rows[index] = { ...row };
    else rows.push({ ...row });
    return row;
  },
};
`,
);
for (const ep of ENDPOINTS) {
  const Ep = pascal(ep);
  write(
    `src/shared/api/endpoints/${ep}.ts`,
    `
import { apiClient, type Page } from "../client.ts";

export interface ${Ep}Row {
  id: string;
  name: string;
  updatedAt: number;
}

export async function list${Ep}(offset = 0, limit = 20): Promise<Page<${Ep}Row>> {
  return apiClient.list<${Ep}Row>("${ep}", { offset, limit });
}

export async function get${Ep}(id: string): Promise<${Ep}Row | undefined> {
  return apiClient.get<${Ep}Row>("${ep}", id);
}

export async function save${Ep}(row: ${Ep}Row): Promise<${Ep}Row> {
  return apiClient.save("${ep}", row);
}
`,
  );
}
write(
  "src/shared/store/create-store.ts",
  `
export interface Store<S> {
  get(): S;
  set(patch: Partial<S>): void;
  subscribe(listener: (state: S) => void): () => void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<(state: S) => void>();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
`,
);
for (const st of STORES) {
  write(
    `src/shared/store/${st}.ts`,
    `
import { createStore } from "./create-store.ts";

export const ${camel(st)} = createStore({ loading: false, error: null as string | null, selected: [] as string[], page: 0 });

export function select${pascal(st)}(id: string): void {
  const { selected } = ${camel(st)}.get();
  ${camel(st)}.set({ selected: selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id] });
}
`,
  );
}
UTILS.forEach((u, i) => {
  const dep = i > 0 && rand() < 0.6 ? UTILS[Math.floor(rand() * i)] : null;
  write(
    `src/shared/utils/${u}.ts`,
    `
${dep ? `import { ${camel(dep)} } from "./${dep}.ts";\n` : ""}
export function ${camel(u)}(input: string): string {
  const base = ${dep ? `${camel(dep)}(input)` : "input"};
  return base.length > ${8 + i} ? \`\${base.slice(0, ${8 + i})}…\` : base;
}

export function ${camel(u)}Many(inputs: string[]): string[] {
  return inputs.map((s) => ${camel(u)}(s)).filter((s, index, all) => all.indexOf(s) === index);
}
`,
  );
});
for (const loc of LOCALES) {
  write(
    `src/shared/i18n/messages-${loc}.ts`,
    `
export const messages = {
  title: "${loc}:title",
  empty: "${loc}:empty",
  save: "${loc}:save",
  cancel: "${loc}:cancel",
  loading: "${loc}:loading",
} as const;
`,
  );
}
write(
  "src/shared/i18n.ts",
  `
${LOCALES.map((l) => `import { messages as ${l} } from "./i18n/messages-${l}.ts";`).join("\n")}

const catalogs = { ${LOCALES.join(", ")} } as const;
export type Locale = keyof typeof catalogs;
export type MessageKey = keyof typeof en;

export function t(locale: Locale, key: MessageKey): string {
  return catalogs[locale]?.[key] ?? en[key];
}
`,
);
for (const v of VALIDATORS) {
  write(
    `src/shared/validation/${v}.ts`,
    `
export interface ValidationResult {
  ok: boolean;
  message?: string;
}

export function ${camel(v)}(value: unknown): ValidationResult {
  if (value == null || value === "") return { ok: false, message: "required" };
  if (typeof value === "string" && value.length > ${40 + VALIDATORS.indexOf(v) * 10}) return { ok: false, message: "too long" };
  return { ok: true };
}
`,
  );
}

// ---------------------------------------------------------------------------
// App shell: context + router (the modules most test files end up mocking)
// ---------------------------------------------------------------------------
write(
  "src/app/context.ts",
  `
import { t, type Locale, type MessageKey } from "#src/shared/i18n";
import { createStore } from "#src/shared/store/create-store";

export interface AppUser {
  id: string;
  name: string;
  roles: string[];
}

export interface AppContext {
  user: AppUser;
  locale: Locale;
  features: Set<string>;
  t(key: MessageKey): string;
}

const session = createStore({ user: { id: "guest", name: "Guest", roles: ["viewer"] } as AppUser, locale: "en" as Locale });

export function useAppContext(): AppContext {
  const { user, locale } = session.get();
  return { user, locale, features: new Set(["beta"]), t: (key) => t(locale, key) };
}

export function setAppUser(user: AppUser): void {
  session.set({ user });
}

export function hasRole(context: AppContext, role: string): boolean {
  return context.user.roles.includes(role) || context.user.roles.includes("admin");
}
`,
);
write(
  "src/app/router.ts",
  `
import { ${camel(UTILS[3])} } from "#src/shared/utils/${UTILS[3]}";

export interface Route {
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
}

const history: Route[] = [{ path: "/", params: {}, query: {} }];

export function useRoute(): Route {
  return history[history.length - 1];
}

export function useRouter() {
  return {
    push(path: string, query: Record<string, string> = {}): void {
      history.push({ path: ${camel(UTILS[3])}(path) === path ? path : path, params: {}, query });
    },
    back(): void {
      if (history.length > 1) history.pop();
    },
    current: useRoute,
  };
}
`,
);

// ---------------------------------------------------------------------------
// Test utilities: like a typical `renderWithProviders`, mounting goes through the app shell,
// which pulls in the whole design system. Most component tests import these.
// ---------------------------------------------------------------------------
write(
  "src/testing/render.ts",
  `
import { useAppContext } from "#src/app/context";
import * as ui from "#src/ui";

export interface RenderResult {
  container: HTMLElement;
  getAllByDs(name: string): HTMLElement[];
  unmount(): void;
}

export function render(node: HTMLElement): RenderResult {
  const context = useAppContext();
  const container = ui.createLayoutStack({ label: context.t("title") });
  container.dataset.testRoot = context.locale;
  container.append(node);
  document.body.append(container);
  return {
    container,
    getAllByDs: (name) => Array.from(container.querySelectorAll<HTMLElement>(\`[data-ds="\${name}"]\`)),
    unmount: () => container.remove(),
  };
}
`,
);
write(
  "src/testing/factories.ts",
  `
import type { ${pascal(ENDPOINTS[0])}Row } from "#src/shared/api/endpoints/${ENDPOINTS[0]}";
import { ${camel(UTILS[7])} } from "#src/shared/utils/${UTILS[7]}";

export function makeItem(overrides: Partial<${pascal(ENDPOINTS[0])}Row> = {}): ${pascal(ENDPOINTS[0])}Row {
  return { id: "item-1", name: ${camel(UTILS[7])}("Item"), updatedAt: 0, ...overrides };
}

export function makeItems(count: number): ${pascal(ENDPOINTS[0])}Row[] {
  return Array.from({ length: count }, (_, i) => makeItem({ id: \`item-\${i}\`, name: \`Item \${i}\` }));
}
`,
);

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------
const COMPONENTS = [
  "list-view",
  "detail-view",
  "edit-form",
  "filter-bar",
  "summary-card",
  "action-menu",
  "history-panel",
];
const COMPOSABLES = ["use-list", "use-form", "use-permissions"];
interface Target {
  kind: "page" | "component" | "composable";
  name: string;
}

// What each test file targets: the page, every component, and two composables (10 files per feature).
const TARGETS: Target[] = [
  { kind: "page", name: "page" },
  ...COMPONENTS.map((name) => ({ kind: "component" as const, name })),
  { kind: "composable", name: "use-list" },
  { kind: "composable", name: "use-form" },
];

let testFiles = 0;
let testCases = 0;
let mockCalls = 0;

for (let f = 0; f < FEATURES; f++) {
  const feature = `feature-${String(f).padStart(2, "0")}`;
  const base = `src/features/${feature}`;
  const [epA, epB] = sample(ENDPOINTS, 2);
  const store = pick(STORES);
  const utils = sample(UTILS, 3);
  const validator = pick(VALIDATORS);

  write(
    `${base}/api.ts`,
    `
import { list${pascal(epA)}, save${pascal(epA)}, type ${pascal(epA)}Row } from "#src/shared/api/endpoints/${epA}";
import { get${pascal(epB)} } from "#src/shared/api/endpoints/${epB}";

export type Item = ${pascal(epA)}Row;

export async function fetchItems(page = 0): Promise<Item[]> {
  return (await list${pascal(epA)}(page * 20, 20)).items;
}

export async function fetchRelated(id: string): Promise<string | undefined> {
  return (await get${pascal(epB)}(id))?.name;
}

export async function saveItem(item: Item): Promise<Item> {
  return save${pascal(epA)}(item);
}
`,
  );
  write(
    `${base}/store.ts`,
    `
import { createStore } from "#src/shared/store/create-store";
import { ${camel(store)} } from "#src/shared/store/${store}";
import type { Item } from "./api.ts";

export const ${camel(feature)}Store = createStore({ items: [] as Item[], filter: "", draft: null as Item | null });

export function resetSelection(): void {
  ${camel(store)}.set({ selected: [] });
}
`,
  );
  write(
    `${base}/use-list.ts`,
    `
import { useAppContext } from "#src/app/context";
import { useRoute } from "#src/app/router";
import { ${camel(utils[0])} } from "#src/shared/utils/${utils[0]}";
import { fetchItems, type Item } from "./api.ts";
import { ${camel(feature)}Store } from "./store.ts";

export function useList() {
  const context = useAppContext();
  const route = useRoute();
  return {
    title: context.t("title"),
    get items(): Item[] {
      return ${camel(feature)}Store.get().items;
    },
    async load(): Promise<Item[]> {
      const page = Number(route.query.page ?? 0);
      const items = await fetchItems(page);
      ${camel(feature)}Store.set({ items });
      return items;
    },
    label(item: Item): string {
      return ${camel(utils[0])}(item.name);
    },
  };
}
`,
  );
  write(
    `${base}/use-form.ts`,
    `
import { useAppContext } from "#src/app/context";
import { useRouter } from "#src/app/router";
import { ${camel(validator)} } from "#src/shared/validation/${validator}";
import { saveItem, type Item } from "./api.ts";
import { ${camel(feature)}Store } from "./store.ts";

export function useForm(initial: Partial<Item> = {}) {
  const context = useAppContext();
  const router = useRouter();
  let draft: Item = { id: initial.id ?? "new", name: initial.name ?? "", updatedAt: initial.updatedAt ?? 0 };
  return {
    get draft(): Item {
      return draft;
    },
    update(patch: Partial<Item>): void {
      draft = { ...draft, ...patch };
      ${camel(feature)}Store.set({ draft });
    },
    validate() {
      return ${camel(validator)}(draft.name);
    },
    async submit(): Promise<boolean> {
      if (!this.validate().ok) return false;
      await saveItem({ ...draft, updatedAt: Date.now() });
      router.push("/${feature}");
      return context.user.id.length > 0;
    },
  };
}
`,
  );
  write(
    `${base}/use-permissions.ts`,
    `
import { hasRole, useAppContext } from "#src/app/context";

export function usePermissions() {
  const context = useAppContext();
  return {
    canEdit: () => hasRole(context, "editor"),
    canDelete: () => hasRole(context, "admin"),
    canView: () => true,
  };
}
`,
  );

  for (const comp of COMPONENTS) {
    const uiPkgs = sample(UI_PACKAGES.slice(1), 4); // + core, which everything uses
    const uiImports = uiPkgs.map((p) => ({ pkg: p, names: sample(uiExports[p], 3) }));
    const composables = sample(COMPOSABLES, 2);
    const used = uiImports.flatMap((u) => u.names);
    write(
      `${base}/components/${comp}.ts`,
      `
${uiImports.map((u) => `import { ${u.names.join(", ")} } from "#src/ui/${u.pkg}";`).join("\n")}
import { cx, el } from "#src/ui/core";
import { ${camel(utils[1])} } from "#src/shared/utils/${utils[1]}";
${composables.map((c) => `import { ${camel(c)} } from "../${c}.ts";`).join("\n")}

export interface ${pascal(comp)}Props {
  title?: string;
  items?: string[];
  compact?: boolean;
}

export function create${pascal(comp)}(props: ${pascal(comp)}Props = {}): HTMLElement {
${composables
  .map(
    (c) =>
      `  const ${camel(c)
        .replace(/^use/, "")
        .replace(/^./, (s) => s.toLowerCase())} = ${camel(c)}();`,
  )
  .join("\n")}
  const root = el("section", { class: cx("${feature}__${comp}", props.compact && "is-compact"), "data-component": "${feature}/${comp}" });
  const heading = el("h2", {}, [${camel(utils[1])}(props.title ?? "${pascal(comp)}")]);
  root.append(heading);
${used.map((name, i) => `  root.append(${name}({ label: \`${comp} ${i}\`, items: props.items ?? [], disabled: props.compact === true && ${i % 2 === 0} }));`).join("\n")}
  return root;
}
`,
    );
  }
  write(
    `${base}/page.ts`,
    `
import * as ui from "#src/ui";
import { createLayoutSection, createLayoutStack } from "#src/ui/layout";
${COMPONENTS.map((c) => `import { create${pascal(c)} } from "./components/${c}.ts";`).join("\n")}

export function create${pascal(feature)}Page(): HTMLElement {
  const root = createLayoutStack({ label: "${feature}" });
  root.dataset.page = "${feature}";
  root.append(
    createLayoutSection({ label: "${feature} layout" }),
    ui.createCoreBadge({ label: "page" }),
${COMPONENTS.map((c) => `    create${pascal(c)}(),`).join("\n")}
  );
  return root;
}
`,
  );

  // -------------------------------------------------------------------------
  // Tests: identical sources for every runner, written against "#host".
  // -------------------------------------------------------------------------
  for (const target of TARGETS.slice(0, FILES_PER_FEATURE)) {
    const mocks: string[] = [];
    // Only mock forms that Vitest and Rstest both support with the same meaning:
    // a synchronous factory, or `{ spy: true }` (keep the real module, wrap every export in a spy).
    // App context and router: mocked by most test files in the original app.
    mocks.push(`host.mock("#src/app/context", () => ({
  useAppContext: () => ({
    user: { id: "u-1", name: "Test User", roles: ["admin"] },
    locale: "en",
    features: new Set(["beta"]),
    t: (key: string) => \`en:\${key}\`,
  }),
  setAppUser: host.fn(),
  hasRole: (context: { user: { roles: string[] } }, role: string) => context.user.roles.includes(role),
}));`);
    mocks.push(`host.mock("#src/app/router", () => ({
  useRoute: () => ({ path: "/", params: {}, query: {} }),
  useRouter: () => ({ push: host.fn(), back: host.fn(), current: () => ({ path: "/", params: {}, query: {} }) }),
}));`);
    // The feature's own API module.
    mocks.push(`host.mock("#src/features/${feature}/api", () => ({
  fetchItems: host.fn(async () => [{ id: "a", name: "Alpha", updatedAt: 0 }]),
  fetchRelated: host.fn(async () => "Related"),
  saveItem: host.fn(async (item: { id: string }) => item),
}));`);
    // Design-system packages spied on as a whole (e.g. to assert on overlays / toasts).
    if (rand() < 0.5) mocks.push(`host.mock("#src/ui/overlay/tooltip", { spy: true });`);
    if (rand() < 0.25) mocks.push(`host.mock("#src/ui/feedback/toggle", { spy: true });`);

    const { imports, cases } = testBody(feature, target);
    for (const variant of ["nomock", "mock"] as const) {
      // The last case proves which module the runner actually loaded: the mocked app context
      // reports "Test User", the real one "Guest". Everything else is identical across suites.
      const contextCase = `  it("reads the app context", async () => {\n    expect(useAppContext().user.name).toBe("${variant === "mock" ? "Test User" : "Guest"}");\n  });\n`;
      const lines = [
        `import { afterEach, describe, expect, host, it } from "#host";`,
        `import { useAppContext } from "#src/app/context";`,
        ...imports,
        "",
        ...(variant === "mock" ? [...mocks, ""] : []),
        `afterEach(() => {`,
        `  document.body.innerHTML = "";`,
        `});`,
        "",
        `describe("${feature}/${target.name}", () => {`,
        ...cases.slice(0, TESTS_PER_FILE - 1),
        contextCase,
        `});`,
        "",
      ];
      write(`tests/${variant}/${feature}/${target.name}.test.ts`, lines.join("\n"));
    }
    testFiles++;
    testCases += Math.min(TESTS_PER_FILE, cases.length);
    mockCalls += mocks.length;
  }
}

function testBody(feature: string, target: Target): { imports: string[]; cases: string[] } {
  const cases: string[] = [];
  const addCase = (title: string, body: string[]) =>
    cases.push(
      `  it("${title}", async () => {\n${body.map((l) => `    ${l}`).join("\n")}\n  });\n`,
    );
  if (target.kind === "page") {
    const imports = [
      `import { create${pascal(feature)}Page } from "#src/features/${feature}/page";`,
      `import { render } from "#src/testing/render";`,
      `import { makeItems } from "#src/testing/factories";`,
    ];
    const factory = `create${pascal(feature)}Page`;
    addCase("renders the page root", [
      `const { container } = render(${factory}());`,
      `expect(container.querySelector("[data-page]")?.getAttribute("data-page")).toBe("${feature}");`,
    ]);
    COMPONENTS.forEach((c) =>
      addCase(`renders ${c}`, [
        `const { container } = render(${factory}());`,
        `expect(container.querySelector('[data-component="${feature}/${c}"]')).not.toBeNull();`,
      ]),
    );
    addCase("renders design-system elements", [
      `const page = ${factory}();`,
      `expect(page.querySelectorAll("[data-ds]").length).toBeGreaterThan(10);`,
    ]);
    addCase("renders headings", [
      `const page = ${factory}();`,
      `expect(page.querySelectorAll("h2").length).toBe(${COMPONENTS.length});`,
      `expect(makeItems(${COMPONENTS.length}).length).toBe(${COMPONENTS.length});`,
    ]);
    while (cases.length < TESTS_PER_FILE)
      addCase(`is stable across renders #${cases.length}`, [
        `expect(${factory}().outerHTML).toBe(${factory}().outerHTML);`,
      ]);
    return { imports, cases };
  }
  if (target.kind === "component") {
    const factory = `create${pascal(target.name)}`;
    const imports = [
      `import { ${factory} } from "#src/features/${feature}/components/${target.name}";`,
      `import { render } from "#src/testing/render";`,
      `import { makeItems } from "#src/testing/factories";`,
    ];
    addCase("renders the root element", [
      `const { container } = render(${factory}());`,
      `expect(container.querySelector("[data-component]")?.getAttribute("data-component")).toBe("${feature}/${target.name}");`,
    ]);
    addCase("renders the title", [
      `const el = ${factory}({ title: "Hello" });`,
      `expect(el.querySelector("h2")?.textContent).toBe("Hello");`,
    ]);
    addCase("falls back to a default title", [
      `const el = ${factory}();`,
      `expect(el.querySelector("h2")?.textContent?.length).toBeGreaterThan(0);`,
    ]);
    addCase("renders design-system children", [
      `const el = ${factory}();`,
      `expect(el.querySelectorAll("[data-ds]").length).toBe(12);`,
    ]);
    addCase("passes items down", [
      `const el = ${factory}({ items: makeItems(2).map((item) => item.name) });`,
      `expect(el.querySelectorAll("li").length).toBe(24);`,
    ]);
    addCase("supports compact mode", [
      `const el = ${factory}({ compact: true });`,
      `expect(el.classList.contains("is-compact")).toBe(true);`,
    ]);
    addCase("is not compact by default", [
      `const el = ${factory}();`,
      `expect(el.classList.contains("is-compact")).toBe(false);`,
    ]);
    addCase("activates an item on click", [
      `const { container } = render(${factory}({ items: ["x"] }));`,
      `const el = container.querySelector("[data-component]") as HTMLElement;`,
      `const item = el.querySelector("li") as HTMLLIElement;`,
      `item.click();`,
      `expect(item.parentElement?.parentElement?.dataset.active).toBe("0");`,
    ]);
    addCase("toggles on Enter", [
      `const el = ${factory}();`,
      `const child = el.querySelector("[data-ds]") as HTMLElement;`,
      `child.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));`,
      `expect(child.classList.contains("is-expanded")).toBe(true);`,
    ]);
    while (cases.length < TESTS_PER_FILE)
      addCase(`is stable across renders #${cases.length}`, [
        `expect(${factory}({ title: "t" }).outerHTML).toBe(${factory}({ title: "t" }).outerHTML);`,
      ]);
    return { imports, cases };
  }
  const fn = camel(target.name);
  const imports = [
    `import { ${fn} } from "#src/features/${feature}/${target.name}";`,
    `import { makeItem } from "#src/testing/factories";`,
  ];
  if (target.name === "use-list") {
    addCase("exposes a title", [`expect(${fn}().title).toMatch(/:title$/);`]);
    addCase("starts empty", [`expect(Array.isArray(${fn}().items)).toBe(true);`]);
    addCase("loads items", [
      `const list = ${fn}();`,
      `const items = await list.load();`,
      `expect(items.length).toBeGreaterThan(0);`,
    ]);
    addCase("stores loaded items", [
      `const list = ${fn}();`,
      `await list.load();`,
      `expect(list.items.length).toBeGreaterThan(0);`,
    ]);
    addCase("formats labels", [`expect(${fn}().label(makeItem({ name: "Name" }))).toBe("Name");`]);
  } else {
    addCase("starts with an empty draft", [`expect(${fn}().draft.name).toBe("");`]);
    addCase("accepts an initial value", [
      `expect(${fn}(makeItem({ name: "Init" })).draft.name).toBe("Init");`,
    ]);
    addCase("updates the draft", [
      `const form = ${fn}();`,
      `form.update({ name: "Next" });`,
      `expect(form.draft.name).toBe("Next");`,
    ]);
    addCase("rejects an empty name", [`expect(${fn}().validate().ok).toBe(false);`]);
    addCase("accepts a valid name", [`expect(${fn}({ name: "ok" }).validate().ok).toBe(true);`]);
    addCase("does not submit invalid drafts", [`expect(await ${fn}().submit()).toBe(false);`]);
    addCase("submits valid drafts", [
      `expect(await ${fn}({ id: "x", name: "ok" }).submit()).toBe(true);`,
    ]);
  }
  while (cases.length < TESTS_PER_FILE)
    addCase(`is deterministic #${cases.length}`, [
      `expect(JSON.stringify(Object.keys(${fn}()))).toBe(JSON.stringify(Object.keys(${fn}())));`,
    ]);
  return { imports, cases };
}

const summary = {
  sourceModules: fileCount - testFiles * 2,
  testFilesPerSuite: testFiles,
  testCasesPerSuite: testCases,
  mockCallsInMockSuite: mockCalls,
};
writeFileSync(
  join(OUT, "summary.json"),
  JSON.stringify({ ...summary, args: { FEATURES, FILES_PER_FEATURE, TESTS_PER_FILE } }, null, 2) +
    "\n",
);
rmSync(DEST, { recursive: true, force: true });
renameSync(OUT, DEST);
console.log(
  `fixture: ${summary.sourceModules} source modules, ${testFiles} test files × 2 suites (nomock / mock), ` +
    `${testCases} test cases per suite, ${mockCalls} host.mock() calls in the mock suite`,
);
