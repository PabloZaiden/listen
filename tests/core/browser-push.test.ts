import "./../setup";
import { describe, expect, test } from "bun:test";
import { toVapidSubject } from "../../src/core/browser-push";

describe("browser push", () => {
  test("uses https origins as VAPID subjects", () => {
    expect(toVapidSubject("https://listen.example.test")).toBe("https://listen.example.test");
  });

  test("uses a valid mailto VAPID subject for local http origins", () => {
    expect(toVapidSubject("http://localhost:3000")).toBe("mailto:listen@example.com");
  });

  test("allows overriding the VAPID subject", () => {
    process.env["LISTEN_VAPID_SUBJECT"] = "mailto:dev@example.test";
    expect(toVapidSubject("http://localhost:3000")).toBe("mailto:dev@example.test");
    delete process.env["LISTEN_VAPID_SUBJECT"];
  });
});