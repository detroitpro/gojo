import { StatusBadge } from "@/ui/StatusBadge";
import { enabledStatus } from "@/kernel/status-icons";

export function EnabledBadge({ enabled }: { enabled: boolean }) {
  const spec = enabledStatus(enabled);
  return <StatusBadge tone={spec.tone} label={spec.label} />;
}
