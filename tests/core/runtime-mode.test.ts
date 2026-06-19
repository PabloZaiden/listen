import "./../setup";
import { describe, expect, test } from "bun:test";
import { resolveServerDevelopmentMode } from "../../src/core/runtime-mode";

describe("runtime mode", () => {
  test("built binary defaults to production when NODE_ENV is unset", () => {
    expect(resolveServerDevelopmentMode(undefined, true)).toBe(false);
  });

  test("source runtime defaults to development when NODE_ENV is unset", () => {
    expect(resolveServerDevelopmentMode(undefined, false)).toBe(true);
  });

  test("explicit production NODE_ENV uses production mode", () => {
    expect(resolveServerDevelopmentMode("production", false)).toBe(false);
  });

  test("explicit development NODE_ENV uses development mode even for binaries", () => {
    expect(resolveServerDevelopmentMode("development", true)).toBe(true);
  });
});
