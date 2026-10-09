// Loaded into uf's Node workers: NODE_OPTIONS="--conditions=repro-uf --import=<this file>".
//
// - uf installs a DOM only for files that render through its React testing helpers, so tests get
//   a happy-dom window here.
// - uf does not hoist module mocks; this hoists them (host/hoisting-hook.ts).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { registerMockHoisting } from "../hoisting-hook.ts";

GlobalRegistrator.register();
registerMockHoisting();
