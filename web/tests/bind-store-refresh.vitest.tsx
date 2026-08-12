// @vitest-environment happy-dom
import { act, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useState } from "react";

import { useBindStoreRefresh } from "@/platform/bind-store-refresh";
import { createRefreshRegistry } from "@/platform/create-refresh-store";

describe("useBindStoreRefresh", () => {
  test("hydrates once on mount even when refresh identity churns each render", async () => {
    const { slice } = createRefreshRegistry();
    const store = slice;
    const refresh = vi.fn(async () => undefined);

    function Probe() {
      const [, setTick] = useState(0);
      // Unstable each render — same failure mode as soft-loading in useCallback deps.
      const load = async () => {
        await refresh();
        setTick((n) => n + 1);
      };
      useBindStoreRefresh(store, load);
      return null;
    }

    render(<Probe />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refresh.mock.calls.length).toBe(1);

    await act(async () => {
      await store.invalidate();
    });
    expect(refresh.mock.calls.length).toBe(2);
  });
});
