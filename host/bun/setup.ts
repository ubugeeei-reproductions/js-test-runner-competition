// Preloaded into `bun test` (bunfig.toml). Bun has no browser mode: tests get a happy-dom window.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
