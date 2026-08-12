import { StatusBadge } from "@/ui/StatusBadge";
import { integrationStatus } from "@/kernel/status-icons";

export function IntegrationStatusBadge({ status }: { status: string }) {
  const spec = integrationStatus(status);
  return <StatusBadge tone={spec.tone} label={spec.label} />;
}
