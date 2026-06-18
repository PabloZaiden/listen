import { describe, expect, test } from "bun:test";
import { getRequestOrigin } from "../../src/core/request-origin";

describe("getRequestOrigin", () => {
  test("uses the last forwarded header value appended by a proxy", () => {
    const origin = getRequestOrigin(new Request("http://internal:3000/", {
      headers: {
        host: "internal:3000",
        "x-forwarded-host": "attacker.example, listen.example.com",
        "x-forwarded-proto": "http, https",
      },
    }));

    expect(origin).toMatchObject({
      protocol: "https",
      host: "listen.example.com",
      origin: "https://listen.example.com",
      secure: true,
    });
  });

  test("derives rpID from bracketed IPv6 host without port or brackets", () => {
    const origin = getRequestOrigin(new Request("http://[::1]:3000/"));

    expect(origin).toMatchObject({
      host: "[::1]:3000",
      origin: "http://[::1]:3000",
      rpID: "::1",
    });
  });
});
