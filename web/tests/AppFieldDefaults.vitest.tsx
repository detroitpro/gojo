// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

const selectSpy = vi.fn((props: Record<string, unknown>) => {
  void props;
  return <div data-testid="atlaskit-select" />;
});

const textfieldSpy = vi.fn((props: Record<string, unknown>) => {
  void props;
  return <input data-testid="atlaskit-textfield" />;
});

vi.mock("@atlaskit/select", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => selectSpy(props),
}));

vi.mock("@atlaskit/textfield", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => textfieldSpy(props),
}));

import { AppSelect } from "@/ui/AppSelect";
import { AppTextfield } from "@/ui/AppTextfield";

describe("App field defaults", () => {
  test("AppSelect defaults spacing to compact", () => {
    selectSpy.mockClear();
    render(<AppSelect options={[{ label: "A", value: "a" }]} />);
    expect(selectSpy).toHaveBeenCalled();
    expect(selectSpy.mock.calls[0]?.[0]).toMatchObject({ spacing: "compact" });
  });

  test("AppSelect allows overriding spacing", () => {
    selectSpy.mockClear();
    render(<AppSelect spacing="default" options={[{ label: "A", value: "a" }]} />);
    expect(selectSpy.mock.calls[0]?.[0]).toMatchObject({ spacing: "default" });
  });

  test("AppTextfield defaults isCompact to true", () => {
    textfieldSpy.mockClear();
    render(<AppTextfield aria-label="Name" />);
    expect(textfieldSpy).toHaveBeenCalled();
    expect(textfieldSpy.mock.calls[0]?.[0]).toMatchObject({ isCompact: true });
  });

  test("AppTextfield allows overriding isCompact", () => {
    textfieldSpy.mockClear();
    render(<AppTextfield isCompact={false} aria-label="Name" />);
    expect(textfieldSpy.mock.calls[0]?.[0]).toMatchObject({ isCompact: false });
  });
});
