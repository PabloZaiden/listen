import { describe, expect, test } from "bun:test";

const styles = await Bun.file("src/web/styles.css").text();

function normalizeSelectorList(selector: string): string {
  return selector
    .split(",")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .join(",");
}

function cssBlock(selector: string): string {
  const normalizedSelector = normalizeSelectorList(selector);

  for (const match of styles.matchAll(/(?<selector>[^{}]+)\s*\{(?<body>[^{}]*)\}/g)) {
    if (normalizeSelectorList(match.groups?.["selector"] ?? "") === normalizedSelector) {
      return match.groups?.["body"] ?? "";
    }
  }

  throw new Error(`Missing CSS block for ${selector}`);
}

function expectDeclaration(selector: string, declaration: string): void {
  expect(cssBlock(selector)).toContain(declaration);
}

describe("notification detail overflow styles", () => {
  test("keeps the detail header title constrained for ellipsis", () => {
    expectDeclaration(".source-filter-list,\n.view-stack,\n.notification-list,\n.source-table", "grid-template-columns: minmax(0, 1fr);");
    expectDeclaration(".view-stack > :not(.view-header)", "min-width: 0;");
    expectDeclaration(".view-header", "min-width: 0;");
    expectDeclaration(".view-header h1", "min-width: 0;");
    expectDeclaration(".view-header h1", "max-width: 100%;");
    expectDeclaration(".view-header h1", "overflow: hidden;");
    expectDeclaration(".view-header h1", "text-overflow: ellipsis;");
    expectDeclaration(".view-header h1", "white-space: nowrap;");
    expectDeclaration(".view-header > div", "flex: 1 1 auto;");
  });

  test("keeps summary and markdown content inside the detail viewport", () => {
    expectDeclaration(".detail-panel", "min-width: 0;");
    expectDeclaration(".detail-panel", "width: auto;");
    expectDeclaration(".detail-summary", "min-width: 0;");
    expectDeclaration(".detail-summary > div", "min-width: 0;");
    expectDeclaration(".detail-summary h2", "overflow-wrap: anywhere;");
    expectDeclaration(".detail-summary p", "overflow-wrap: anywhere;");
    expectDeclaration(".markdown", "min-width: 0;");
    expectDeclaration(".markdown", "max-width: 100%;");
    expectDeclaration(".markdown", "overflow-wrap: anywhere;");
    expectDeclaration(".markdown pre", "max-width: 100%;");
    expectDeclaration(".markdown pre", "overflow-x: auto;");
    expectDeclaration(".markdown table", "table-layout: fixed;");
    expectDeclaration(".detail-actions-row", "min-width: 0;");
  });
});
