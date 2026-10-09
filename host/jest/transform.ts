// Jest transformer: "#host" → `jest` (host/rewrite.ts), then babel-jest, which compiles TypeScript
// to CommonJS and, with babel-plugin-jest-hoist, lifts `jest.mock()` above the imports.
import babelJest from "babel-jest";
import { isTestFile, renameHostForJest } from "../rewrite.ts";

interface Transformer {
  process(source: string, path: string, options: unknown): { code: string };
  getCacheKey(source: string, path: string, options: unknown): string;
}

const babel = (babelJest.createTransformer as (options: object) => Transformer)({
  babelrc: false,
  configFile: false,
  presets: [["@babel/preset-env", { targets: { node: "current" } }], "@babel/preset-typescript"],
});

const rewrite = (source: string, path: string) =>
  isTestFile(path) ? (renameHostForJest(source) ?? source) : source;

export default {
  ...babel,
  process: (source: string, path: string, options: unknown) =>
    babel.process(rewrite(source, path), path, options),
  getCacheKey: (source: string, path: string, options: unknown) =>
    babel.getCacheKey(rewrite(source, path), path, options),
};
