// Loaded into `node --test` and its test processes: `--conditions=repro-node --import=<this file>`.
//
// - Node has no DOM: tests get a happy-dom window.
// - `mock.module()` is not hoisted; this hoists it (host/hoisting-hook.ts).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { registerMockHoisting } from "../hoisting-hook.ts";

GlobalRegistrator.register();
registerMockHoisting();
