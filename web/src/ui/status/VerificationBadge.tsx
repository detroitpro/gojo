import { StatusBadge } from "@/ui/StatusBadge";
import { verificationStatus } from "@/kernel/status-icons";

export function VerificationBadge({ verification }: { verification: string }) {
  const spec = verificationStatus(verification);
  return <StatusBadge tone={spec.tone} label={spec.label} />;
}
