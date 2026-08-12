import { StatusBadge } from "@/ui/StatusBadge";
import { channelTypeStatus } from "@/kernel/status-icons";

export function ChannelTypeBadge({ type }: { type: string }) {
  const spec = channelTypeStatus(type);
  return <StatusBadge tone={spec.tone} label={spec.label} />;
}
