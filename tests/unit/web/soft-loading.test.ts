import { describe, expect, test } from "bun:test";

import { useSoftLoading } from "../../../web/src/composables/useSoftLoading";

describe("useSoftLoading", () => {
  test("only the first begin/end pair toggles loading", () => {
    const soft = useSoftLoading();
    expect(soft.loading.value).toBe(true);

    const first = soft.begin();
    expect(first).toBe(true);
    expect(soft.loading.value).toBe(true);
    soft.end(first);
    expect(soft.loading.value).toBe(false);

    const second = soft.begin();
    expect(second).toBe(false);
    expect(soft.loading.value).toBe(false);
    soft.end(second);
    expect(soft.loading.value).toBe(false);
  });

  test("reset allows a skeleton on entity navigation", () => {
    const soft = useSoftLoading();
    soft.end(soft.begin());
    soft.reset();
    expect(soft.loading.value).toBe(true);
    const again = soft.begin();
    expect(again).toBe(true);
    soft.end(again);
    expect(soft.loading.value).toBe(false);
  });
});
