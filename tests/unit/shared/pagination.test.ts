import { describe, expect, test } from "bun:test";

import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  pageCount,
  paginateArray,
  parsePageParams,
  rangeLabel,
} from "@shared/pagination";

describe("pagination", () => {
  test("parsePageParams clamps limit and defaults", () => {
    expect(parsePageParams({})).toEqual({ limit: DEFAULT_PAGE_LIMIT, offset: 0 });
    expect(parsePageParams({ limit: "0" }).limit).toBe(DEFAULT_PAGE_LIMIT);
    expect(parsePageParams({ limit: "999" }).limit).toBe(MAX_PAGE_LIMIT);
    expect(parsePageParams({ limit: "10", offset: "50" })).toEqual({
      limit: 10,
      offset: 50,
    });
  });

  test("paginateArray slices and reports total", () => {
    const items = [1, 2, 3, 4, 5];
    expect(paginateArray(items, { limit: 2, offset: 2 })).toEqual({
      items: [3, 4],
      total: 5,
      limit: 2,
      offset: 2,
    });
  });

  test("rangeLabel and pageCount", () => {
    expect(rangeLabel(0, 25, 0)).toBe("Showing 0 of 0");
    expect(rangeLabel(40, 25, 0)).toBe("Showing 1–25 of 40");
    expect(rangeLabel(40, 25, 25)).toBe("Showing 26–40 of 40");
    expect(pageCount(40, 25)).toBe(2);
    expect(pageCount(0, 25)).toBe(1);
  });
});
