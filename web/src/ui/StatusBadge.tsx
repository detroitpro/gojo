import Lozenge from "@atlaskit/lozenge";

import type { BadgeTone } from "@/kernel/status-icons";

export type StatusBadgeProps = {
  tone: BadgeTone;
  label: string;
};

function appearanceFor(
  tone: BadgeTone,
): "default" | "success" | "removed" | "inprogress" | "new" | "moved" {
  switch (tone) {
    case "success":
      return "success";
    case "failed":
      return "removed";
    case "warn":
      return "moved";
    case "running":
      return "inprogress";
    case "queued":
      return "new";
    default:
      return "default";
  }
}

export function StatusBadge({ tone, label }: StatusBadgeProps) {
  return <Lozenge appearance={appearanceFor(tone)}>{label}</Lozenge>;
}
