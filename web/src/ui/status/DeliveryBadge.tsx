import type { WorkDelivery } from "@gojo/contracts/types";

import { StatusBadge } from "@/ui/StatusBadge";
import { deliveryStatus } from "@/kernel/status-icons";

export function DeliveryBadge({ delivery }: { delivery: WorkDelivery | string }) {
  const spec = deliveryStatus(delivery);
  return <StatusBadge tone={spec.tone} label={spec.label} />;
}
