import { StatusBadge } from "@/ui/StatusBadge";
import { workKindStatus } from "@/kernel/status-icons";

export function WorkKindBadge({ kind }: { kind: string }) {
  const spec = workKindStatus(kind);
  return <StatusBadge tone={spec.tone} label={spec.label} />;
}
