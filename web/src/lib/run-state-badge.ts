/** CSS class for a run state badge / strip cell (matches StateBadge). */
export function runStateBadgeClass(state: string): string {
  if (["Running", "Preparing", "Validating", "Integrating", "Reporting"].includes(state)) {
    return "badge-running";
  }
  if (["Queued", "Scheduled"].includes(state)) {
    return "badge-queued";
  }
  if (state === "Succeeded") {
    return "badge-success";
  }
  if (["Failed", "Canceled", "TimedOut", "InfrastructureFailure", "Conflict"].includes(state)) {
    return "badge-failed";
  }
  if (state === "AwaitingApproval") {
    return "badge-warn";
  }
  return "badge-neutral";
}
