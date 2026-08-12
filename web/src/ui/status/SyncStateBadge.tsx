import type { SourceSyncState } from "@gojo/contracts/types";

import { StatusBadge } from "@/ui/StatusBadge";
import { syncStateStatus } from "@/kernel/status-icons";

export function SyncStateBadge({
  syncState,
  showLabel: _showLabel = true,
}: {
  syncState: SourceSyncState | string;
  showLabel?: boolean;
}) {
  const spec = syncStateStatus(syncState);
  return <StatusBadge tone={spec.tone} label={spec.label} />;
}
