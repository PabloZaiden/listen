import { describe, expect, test } from "bun:test";
import { parseAppRoute, routePath } from "../../src/web/routes";

describe("app routes", () => {
  test("parses top-level routes", () => {
    expect(parseAppRoute("/").route).toEqual({ name: "inbox" });
    expect(parseAppRoute("/sources").route).toEqual({ name: "sources" });
    expect(parseAppRoute("/settings").route).toEqual({ name: "settings" });
  });

  test("parses notification detail routes", () => {
    expect(parseAppRoute("/notifications/abc-123").route).toEqual({ name: "notification", id: "abc-123" });
  });

  test("redirects malformed routes to inbox with an error", () => {
    const parsed = parseAppRoute("/notifications/");

    expect(parsed.route).toEqual({ name: "inbox" });
    expect(parsed.error).toBe("That notification link is invalid.");
  });

  test("formats routes", () => {
    expect(routePath({ name: "inbox" })).toBe("/");
    expect(routePath({ name: "notification", id: "id with space" })).toBe("/notifications/id%20with%20space");
  });
});
