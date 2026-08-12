import { StatusBadge } from "@/ui/StatusBadge";
import { runStateStatus } from "@/kernel/status-icons";

export function StateBadge({ state }: { state: string }) {
  const spec = runStateStatus(state);
  return <StatusBadge tone={spec.tone} label={spec.label} />;
}
