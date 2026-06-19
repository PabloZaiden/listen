import { describe, expect, test } from "bun:test";
import { normalizeMarkdownForDisplay } from "../../src/web/markdown";

describe("markdown display normalization", () => {
  test("converts escaped newline sequences when markdown has no real newlines", () => {
    expect(normalizeMarkdownForDisplay("Intro\\n\\n- One\\n- Two")).toBe("Intro\n\n- One\n- Two");
  });

  test("keeps markdown with real newlines unchanged", () => {
    const markdown = "Intro\n\n- Keep literal \\n text";

    expect(normalizeMarkdownForDisplay(markdown)).toBe(markdown);
  });
});