import type { SourceSyncState, WorkDelivery } from "@gojo/contracts/types";

const ACTIVE_DELIVERY_STATES = new Set<WorkDelivery>([
  "draft",
  "open",
  "review",
  "blocked",
]);

export function isVerifiedActiveDelivery(item: {
  delivery: WorkDelivery;
  syncState: SourceSyncState;
}): boolean {
  return item.syncState === "current" && ACTIVE_DELIVERY_STATES.has(item.delivery);
}
