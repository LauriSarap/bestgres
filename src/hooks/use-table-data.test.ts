import { describe, expect, it } from "vitest";
import { PAGE_SIZE, quoteIdent } from "./use-table-data";

describe("table query helpers", () => {
  it("quotes identifiers and doubles embedded quotes", () => {
    expect(quoteIdent('odd"name')).toBe('"odd""name"');
  });

  it("keeps the pagination batch bounded", () => {
    expect(PAGE_SIZE).toBe(200);
  });
});

import { MAX_CELL_CHARS, buildSelectList, markTruncated, wideColumns } from "./use-table-data";
import { TruncatedValue } from "@/lib/truncated-value";

describe("wide column previews", () => {
  const cols: [string, string][] = [
    ["id", "text"],
    ["name", "text"],
    ["n", "integer"],
    ["boundary", "jsonb"],
  ];

  it("caps wide non-PK columns and keeps output names", () => {
    expect(buildSelectList(cols, ["id"])).toBe(
      `"id", left("name"::text, ${MAX_CELL_CHARS + 1}) AS "name", "n", left("boundary"::text, ${MAX_CELL_CHARS + 1}) AS "boundary"`
    );
    expect(wideColumns(cols, ["id"])).toEqual(new Set(["name", "boundary"]));
  });

  it("falls back to * without column metadata", () => {
    expect(buildSelectList([], [])).toBe("*");
  });

  it("marks over-cap previews and leaves other cells untouched", () => {
    const big = "x".repeat(MAX_CELL_CHARS + 1);
    const small = "y".repeat(MAX_CELL_CHARS);
    const rows = [["a", small, 1, big], ["b", null, 2, small]];
    const out = markTruncated(rows, ["id", "name", "n", "boundary"], new Set(["name", "boundary"]));
    expect(out[0][3]).toBeInstanceOf(TruncatedValue);
    expect((out[0][3] as TruncatedValue).preview).toHaveLength(MAX_CELL_CHARS);
    expect(out[0][1]).toBe(small);
    expect(out[1]).toBe(rows[1]);
  });
});
