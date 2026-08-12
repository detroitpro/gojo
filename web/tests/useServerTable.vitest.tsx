// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { useServerTable } from "@/platform/useServerTable";

describe("useServerTable", () => {
  test("reloads when watchSources change even if already on page 1", async () => {
    const fetchPage = vi.fn(async ({ offset }: { offset: number }) => ({
      items: [{ id: `row-${offset}`, label: String(offset) }],
      total: 1,
    }));

    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string }) =>
        useServerTable({
          defaultSort: "name",
          watchSources: [projectId],
          fetchPage: () => fetchPage({ offset: 0, limit: 25, sort: "name", order: "asc" }),
        }),
      { initialProps: { projectId: "all" } },
    );

    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1));
    expect(result.current.items[0]?.id).toBe("row-0");

    fetchPage.mockImplementation(async () => ({
      items: [{ id: "filtered", label: "p1" }],
      total: 1,
    }));

    await act(async () => {
      rerender({ projectId: "project-1" });
    });

    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect(result.current.items[0]?.id).toBe("filtered");
  });

  test("resets to page 1 and reloads when filters change from a later page", async () => {
    const fetchPage = vi.fn(
      async ({ offset }: { limit: number; offset: number; sort: string; order: string }) => ({
        items: [{ id: `off-${offset}` }],
        total: 50,
      }),
    );

    const { result, rerender } = renderHook(
      ({ q }: { q: string }) =>
        useServerTable({
          pageSize: 25,
          defaultSort: "name",
          watchSources: [q],
          fetchPage,
        }),
      { initialProps: { q: "" } },
    );

    await waitFor(() => expect(result.current.items[0]?.id).toBe("off-0"));

    await act(async () => {
      result.current.setPage(2);
    });
    await waitFor(() => expect(result.current.page).toBe(2));
    await waitFor(() => expect(result.current.items[0]?.id).toBe("off-25"));

    const callsBeforeFilter = fetchPage.mock.calls.length;

    await act(async () => {
      rerender({ q: "search" });
    });

    await waitFor(() => expect(result.current.page).toBe(1));
    await waitFor(() => expect(fetchPage.mock.calls.length).toBeGreaterThan(callsBeforeFilter));
    expect(result.current.items[0]?.id).toBe("off-0");
  });
});
