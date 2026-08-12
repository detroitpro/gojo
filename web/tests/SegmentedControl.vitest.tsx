// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { SegmentedControl } from "@/ui/SegmentedControl";

describe("SegmentedControl", () => {
  const items = [
    { value: "all", label: "All", count: 10 },
    { value: "open", label: "Open", count: 2 },
    { value: "merged", label: "Merged", icon: <span data-testid="merged-icon" /> },
  ] as const;

  test("renders labels, counts, and selected aria-pressed", () => {
    render(
      <SegmentedControl
        ariaLabel="Status"
        items={[...items]}
        value="open"
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole("group", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All (10)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Open (2)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Merged" })).toBeInTheDocument();
    expect(screen.getByTestId("merged-icon")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  test("calls onChange when a segment is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Status"
        items={[...items]}
        value="all"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open (2)" }));
    expect(onChange).toHaveBeenCalledWith("open");
  });

  test("arrow keys move selection and focus", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Status"
        items={[...items]}
        value="all"
        onChange={onChange}
      />,
    );

    screen.getByRole("button", { name: "All (10)" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("open");
    expect(screen.getByRole("button", { name: "Open (2)" })).toHaveFocus();
  });
});
