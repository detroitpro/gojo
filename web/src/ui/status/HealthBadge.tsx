import { StatusBadge } from "@/ui/StatusBadge";
import { healthStatus } from "@/kernel/status-icons";

export function HealthBadge({
  level,
  label,
}: {
  level: "ok" | "warn" | "error" | "missing" | string;
  label?: string;
}) {
  const spec = healthStatus(level);
  return <StatusBadge tone={spec.tone} label={label ?? spec.label} />;
}
