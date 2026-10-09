// Config for `vp test` (Vite+). Same settings as vitest.config.ts, through Vite+'s entry points.
import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";
import { hostPlugin } from "./host/vitest/plugin.ts";

// REPRO_ENV=happy-dom runs the suite in Node with happy-dom instead of a real browser.
const browser = process.env.REPRO_ENV !== "happy-dom";

export default defineConfig({
  plugins: [hostPlugin()],
  test: {
    include: ["fixture/tests/**/*.test.ts"],
    // REPRO_ISOLATE=false: browser mode runs the files of a worker in the same iframe,
    // happy-dom keeps one module graph per worker.
    isolate: process.env.REPRO_ISOLATE !== "false",
    ...(browser
      ? {
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        }
      : { environment: "happy-dom" }),
  },
});
