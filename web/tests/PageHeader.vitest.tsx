// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import AppProvider from "@atlaskit/app-provider";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

import { PageHeader } from "@/ui/PageHeader";

function wrap(node: ReactElement) {
  return render(
    <AppProvider defaultColorMode="light">
      <MemoryRouter>{node}</MemoryRouter>
    </AppProvider>,
  );
}

describe("PageHeader", () => {
  test("renders title and subtitle from props", () => {
    wrap(<PageHeader title="Agents" subtitle="Manifest-synced agents" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Agents");
    expect(screen.getByText("Manifest-synced agents")).toBeInTheDocument();
  });

  test("omits subtitle when not provided", () => {
    wrap(<PageHeader title="Settings" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Settings");
  });

  test("renders actions passed as a node", () => {
    wrap(
      <PageHeader
        title="Projects"
        actions={<button data-testid="probe">Add</button>}
      />,
    );
    expect(screen.getByTestId("probe")).toBeInTheDocument();
  });

  test("renders subtitle nodes", () => {
    wrap(
      <PageHeader
        title="Runs"
        subtitle={<span data-testid="subtitle-node">Execution history</span>}
      />,
    );
    expect(screen.getByTestId("subtitle-node")).toHaveTextContent("Execution history");
  });
});
