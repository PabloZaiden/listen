import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import packageJson from "../../package.json";
import { VersionLegend } from "../../src/web/versionLegend";

describe("version legend", () => {
  test("renders the package version", () => {
    expect(renderToStaticMarkup(<VersionLegend />)).toBe(`<footer class="version-legend">listen ${packageJson.version}</footer>`);
  });
});

