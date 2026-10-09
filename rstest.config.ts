import { defineConfig } from "@rstest/core";
import { hostPlugin } from "./host/rstest/plugin.ts";

// REPRO_ENV=happy-dom runs the suite in Node with happy-dom instead of a real browser.
const browser = process.env.REPRO_ENV !== "happy-dom";

export default defineConfig({
  plugins: [hostPlugin()],
  include: ["fixture/tests/**/*.test.ts"],
  isolate: process.env.REPRO_ISOLATE !== "false",
  ...(browser
    ? {
        browser: {
          enabled: true,
          headless: true,
          provider: "playwright",
          browser: "chromium",
        },
      }
    : { testEnvironment: "happy-dom" }),
});
