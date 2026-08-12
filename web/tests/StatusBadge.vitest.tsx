// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { toneIcon, type BadgeTone } from "@/kernel/status-icons";
import { StatusBadge } from "@/ui/StatusBadge";

const TONES: BadgeTone[] = ["success", "failed", "warn", "running", "queued", "neutral"];

describe("StatusBadge", () => {
  test("renders label and tone class", () => {
    const { container } = render(<StatusBadge tone="success" label="Succeeded" />);
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    const badge = container.querySelector(".badge.badge-neutral.badge--tone-success");
    expect(badge).toBeTruthy();
    expect(badge?.querySelector(".badge__icon")).toBeTruthy();
  });

  test.each(TONES)("toneIcon(%s) returns a lucide component", (tone) => {
    const Icon = toneIcon(tone);
    expect(Icon).toBeTruthy();
    const { container } = render(<StatusBadge tone={tone} label={tone} />);
    expect(container.querySelector(`.badge--tone-${tone} .badge__icon svg`)).toBeTruthy();
  });
});
