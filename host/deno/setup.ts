// Preloaded into `deno test` (--preload). Deno has no DOM: tests get a happy-dom window.
//
// The test runner dispatches its own lifecycle events on `globalThis`, so the global event methods
// stay Deno's; the DOM the tests use (document, elements, their events) is happy-dom's.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const { addEventListener, removeEventListener, dispatchEvent } = globalThis;
GlobalRegistrator.register();
Object.assign(globalThis, { addEventListener, removeEventListener, dispatchEvent });
