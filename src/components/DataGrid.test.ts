import { describe, expect, it } from "vitest";
import {
  formatInspectorValue,
  formatRows,
  stringifyCell,
  type GridColumn,
} from "./DataGrid";

const columns: GridColumn[] = [{ name: "name" }, { name: "payload" }];
const rows = [["Alice, \"A\"", { active: true }], [null, "a|b"]];

describe("DataGrid serialization", () => {
  it("stringifies nulls, objects, and scalars consistently", () => {
    expect(stringifyCell(null)).toBe("NULL");
    expect(stringifyCell({ active: true })).toBe('{"active":true}');
    expect(stringifyCell(42)).toBe("42");
  });

  it("pretty-prints object and string-encoded JSON for the inspector", () => {
    expect(formatInspectorValue({ profile: { name: "Ada" }, active: true })).toBe(
      '{\n  "profile": {\n    "name": "Ada"\n  },\n  "active": true\n}'
    );
    expect(formatInspectorValue('{"items":[1,2]}')).toBe(
      '{\n  "items": [\n    1,\n    2\n  ]\n}'
    );
    expect(formatInspectorValue("ordinary text")).toBe("ordinary text");
    expect(formatInspectorValue(null)).toBe("NULL");
  });

  it("escapes CSV fields and quotes", () => {
    expect(formatRows(columns, rows, "csv")).toBe(
      'name,payload\n"Alice, ""A""","{""active"":true}"\nNULL,a|b'
    );
  });

  it("produces structured JSON", () => {
    expect(JSON.parse(formatRows(columns, rows, "json"))).toEqual([
      { name: 'Alice, "A"', payload: { active: true } },
      { name: null, payload: "a|b" },
    ]);
  });

  it("escapes markdown pipes", () => {
    expect(formatRows(columns, [rows[1]], "markdown")).toContain("NULL | a\\|b");
  });

  it("uses tabs without CSV quoting for TSV", () => {
    expect(formatRows(columns, [["a,b", "x"]], "tsv")).toBe("name\tpayload\na,b\tx");
  });
});
