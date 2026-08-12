import { StatusBadge } from "@/ui/StatusBadge";
import { workResultStatus } from "@/kernel/status-icons";
import type { WorkItem } from "@/contexts/work/types";

export function WorkResultBadge({
  item,
}: {
  item: Pick<WorkItem, "resolution" | "delivery" | "outcome">;
}) {
  const spec = workResultStatus(item);
  return <StatusBadge tone={spec.tone} label={spec.label} />;
}
