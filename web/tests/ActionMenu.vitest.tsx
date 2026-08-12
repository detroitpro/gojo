// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import AppProvider from "@atlaskit/app-provider";
import { MemoryRouter } from "react-router-dom";

import { ActionMenu } from "@/ui/ActionMenu";

function wrap(node: React.ReactElement) {
  return render(
    <AppProvider defaultColorMode="light">
      <MemoryRouter>{node}</MemoryRouter>
    </AppProvider>,
  );
}

describe("ActionMenu", () => {
  test("opens and selects an action", async () => {
    const onSelect = vi.fn();
    wrap(
      <ActionMenu
        label="Project actions"
        items={[{ id: "remove", label: "Remove project", danger: true }]}
        onSelect={onSelect}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /project actions/i }));
    });

    const item = await screen.findByRole("menuitem", { name: /remove project/i });
    await act(async () => {
      fireEvent.click(item);
    });

    expect(onSelect).toHaveBeenCalledWith("remove");
    expect(screen.queryByRole("menuitem", { name: /remove project/i })).toBeNull();
  });
});
