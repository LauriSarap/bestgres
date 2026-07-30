import { describe, expect, it } from "vitest";
import {
  clampInspectorHeight,
  INSPECTOR_DEFAULT_HEIGHT,
  INSPECTOR_HEIGHT_KEY,
  INSPECTOR_MIN_HEIGHT,
  maxInspectorHeight,
  readInspectorHeight,
  resizedInspectorHeight,
} from "./inspector-layout";

describe("inspector layout", () => {
  it("grows upward and shrinks downward while dragging", () => {
    expect(resizedInspectorHeight(192, 500, 400, 800)).toBe(292);
    expect(resizedInspectorHeight(292, 400, 500, 800)).toBe(192);
  });

  it("keeps both the inspector and data grid usable", () => {
    expect(clampInspectorHeight(40, 800)).toBe(INSPECTOR_MIN_HEIGHT);
    expect(clampInspectorHeight(900, 800)).toBe(maxInspectorHeight(800));
    expect(maxInspectorHeight(800)).toBe(620);
  });

  it("restores a valid saved height and rejects invalid values", () => {
    localStorage.setItem(INSPECTOR_HEIGHT_KEY, "420");
    expect(readInspectorHeight(localStorage, 800)).toBe(420);

    localStorage.setItem(INSPECTOR_HEIGHT_KEY, "not-a-number");
    expect(readInspectorHeight(localStorage, 800)).toBe(INSPECTOR_DEFAULT_HEIGHT);
  });
});
