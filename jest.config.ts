import type { Config } from "jest";

const config: Config = {
  testMatch: ["<rootDir>/fixture/tests/**/*.test.ts"],
  testEnvironment: "@happy-dom/jest-environment",
  transform: { "\\.ts$": "<rootDir>/host/jest/transform.ts" },
  moduleFileExtensions: ["ts", "js", "mjs", "cjs", "json"],
};

export default config;
