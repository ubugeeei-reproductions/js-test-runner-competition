// "#host" for `deno test`, selected by Deno's own "deno" condition in package.json "imports".
//
// Deno has no module mocking, so `deno test` runs only the no-mock suite.
import { expect } from "@std/expect";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { spy } from "@std/testing/mock";

export const host = {
  mock(): never {
    throw new Error("`deno test` has no module mocking");
  },
  fn: spy,
};

export { afterEach, beforeEach, describe, expect, it };
