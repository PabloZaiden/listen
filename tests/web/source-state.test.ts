import { describe, expect, test } from "bun:test";
import type { SourceResponse } from "@listen/contracts";
import {
  reconcileCreatedSource,
  reconcileDeletedSource,
  reconcileRotatedSource,
} from "../../src/web/source-state";

function source(id: string, name = id): SourceResponse {
  return {
    id,
    name,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
  };
}

describe("source state", () => {
  test("reconciles create, rotate, and delete responses without a follow-up fetch", () => {
    const existing = source("existing");
    const created = source("created", "Created");
    const rotated = { ...existing, name: "Renamed", updatedAt: "2026-07-16T00:01:00.000Z" };

    const afterCreate = reconcileCreatedSource([existing], created);
    expect(afterCreate).toEqual([created, existing]);
    expect(reconcileRotatedSource(afterCreate, rotated)).toEqual([created, rotated]);
    expect(reconcileDeletedSource([created, rotated], created.id)).toEqual([rotated]);
  });

});
