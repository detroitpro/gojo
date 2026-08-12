import type { WorkAttention } from "@gojo/contracts/types";

import { StatusBadge } from "@/ui/StatusBadge";
import { attentionStatus } from "@/kernel/status-icons";

export function AttentionBadge({
  attention,
  showLabel: _showLabel,
}: {
  attention: WorkAttention | string;
  showLabel?: boolean;
}) {
  const spec = attentionStatus(attention);
  return <StatusBadge tone={spec.tone} label={spec.label} />;
}
