// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import AppProvider from "@atlaskit/app-provider";
import { MemoryRouter } from "react-router-dom";
import { Play } from "lucide-react";

import { AppButton } from "@/ui/AppButton";

function wrap(node: React.ReactElement) {
  return render(
    <AppProvider defaultColorMode="light">
      <MemoryRouter>{node}</MemoryRouter>
    </AppProvider>,
  );
}

describe("AppButton", () => {
  test("renders icon and label with primary variant", () => {
    wrap(
      <AppButton variant="primary" iconBefore={<Play data-testid="icon" />}>
        Run now
      </AppButton>,
    );
    const button = screen.getByRole("button", { name: /run now/i });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  test("navigates via LinkButton href for react-router paths", () => {
    wrap(<AppButton to="/projects/abc/history">History</AppButton>);
    const link = screen.getByRole("link", { name: /history/i });
    expect(link).toHaveAttribute("href", "/projects/abc/history");
  });

  test("shows loading label and disables while busy", () => {
    wrap(
      <AppButton
        iconBefore={<Play data-testid="icon" />}
        loading
        loadingLabel="Running…"
      >
        Run now
      </AppButton>,
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button.textContent ?? "").toContain("Running…");
    expect(button.textContent ?? "").not.toContain("Run now");
  });

  test("md size applies default wrapper class", () => {
    const { container } = wrap(<AppButton>Pause scheduler</AppButton>);
    expect(container.querySelector(".app-button--md")).toBeTruthy();
    expect(container.querySelector(".app-button--sm")).toBeNull();
  });

  test("sm size uses compact wrapper", () => {
    const { container } = wrap(<AppButton size="sm">Tiny</AppButton>);
    expect(container.querySelector(".app-button--sm")).toBeTruthy();
  });
});
