// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, beforeEach } from "vitest";
import AppProvider from "@atlaskit/app-provider";

import {
  COLOR_MODE_STORAGE_KEY,
  readStoredColorMode,
  writeStoredColorMode,
} from "@/platform/color-mode";
import { ColorModeMenu } from "@/ui/ColorModeMenu";

describe("color-mode storage", () => {
  beforeEach(() => {
    localStorage.removeItem(COLOR_MODE_STORAGE_KEY);
  });

  test("defaults to light", () => {
    expect(readStoredColorMode()).toBe("light");
  });

  test("round-trips preference", () => {
    writeStoredColorMode("dark");
    expect(readStoredColorMode()).toBe("dark");
    writeStoredColorMode("auto");
    expect(readStoredColorMode()).toBe("auto");
  });
});

describe("ColorModeMenu", () => {
  beforeEach(() => {
    localStorage.removeItem(COLOR_MODE_STORAGE_KEY);
  });

  test("persists dark mode when selected", async () => {
    render(
      <AppProvider defaultColorMode="light">
        <ColorModeMenu />
      </AppProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /color mode: light/i }));
    });

    const dark = await screen.findByRole("menuitemradio", { name: /^dark$/i });
    await act(async () => {
      fireEvent.click(dark);
    });

    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe("dark");
    expect(readStoredColorMode()).toBe("dark");
  });
});
