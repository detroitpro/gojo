import { StatusBadge } from "@/ui/StatusBadge";
import { provenanceStatus } from "@/kernel/status-icons";

export function ProvenanceBadge({ provenance }: { provenance: string }) {
  const spec = provenanceStatus(provenance);
  return <StatusBadge tone={spec.tone} label={spec.label} />;
}
