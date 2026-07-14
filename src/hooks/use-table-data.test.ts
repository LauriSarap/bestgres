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
