// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

import { StatTile } from "@/ui/StatTile";

function wrap(node: ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe("StatTile", () => {
  test("renders catalog label, value, and delta", () => {
    const { container } = wrap(
      <StatTile
        metricKey="dashboard.runs"
        value={12}
        previous={9}
        compareLabel="vs 24 hours ago"
      />,
    );
    expect(container.querySelector(".stat-tile__header")).not.toBeNull();
    expect(container.querySelector(".stat-tile__header .stat-tile__icon")).not.toBeNull();
    expect(container.querySelector(".stat-tile__header .stat-tile__label")?.textContent).toBe(
      "Runs",
    );
    expect(container.querySelector(".stat-tile__value")?.textContent).toBe("12");
    expect(container.textContent ?? "").toContain("+3");
    const tile = container.querySelector(".stat-tile");
    expect(tile?.getAttribute("aria-label")).toContain("Runs: 12");
  });

  test("shows attention flag for attention metrics with a positive value", () => {
    const { container } = wrap(
      <StatTile metricKey="work.needsAttention" value={2} previous={1} />,
    );
    expect(container.querySelector(".stat-tile__flag")).not.toBeNull();
  });

  test("renders a router link when to is set", () => {
    wrap(<StatTile metricKey="impact.prsOpen" value={3} to="/projects" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/projects");
  });

  test("hides delta when previous is null", () => {
    const { container } = wrap(
      <StatTile metricKey="dashboard.projects" value={4} previous={null} />,
    );
    expect(container.querySelector(".metric-delta")).toBeNull();
  });
});
