import type { WorkExecution } from "@gojo/contracts/types";

import { StatusBadge } from "@/ui/StatusBadge";
import { executionStatus } from "@/kernel/status-icons";

export function ExecutionBadge({
  execution,
  showLabel: _showLabel,
}: {
  execution: WorkExecution | string;
  showLabel?: boolean;
}) {
  const spec = executionStatus(execution);
  return <StatusBadge tone={spec.tone} label={spec.label} />;
}
