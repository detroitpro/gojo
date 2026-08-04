import type { WorkAttention, WorkItem } from "@gojo/contracts/types";

export type AttentionMenuItem = {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  to?: { name: string; params?: Record<string, string>; query?: Record<string, string> };
};

export type AttentionPrimaryAction =
  | { id: "review-run"; label: string; kind: "route"; to: { name: string; params: { id: string } } }
  | { id: "open-run"; label: string; kind: "route"; to: { name: string; params: { id: string } } }
  | { id: "recheck-item"; label: string; kind: "action" }
  | { id: "retry-source"; label: string; kind: "action" }
  | { id: "open-source"; label: string; kind: "href"; href: string }
  | null;

export function workExternalHref(
  item: WorkItem,
  sourceWebUrl: string | null | undefined,
): string | null {
  if (item.webUrl) return item.webUrl;
  if (sourceWebUrl) return sourceWebUrl;
  return null;
}

export function attentionPrimaryAction(
  item: WorkItem,
  sourceWebUrl?: string | null,
): AttentionPrimaryAction {
  if (item.attention === "approval" && item.kind === "run" && item.nativeKey) {
    return {
      id: "review-run",
      label: "Review run",
      kind: "route",
      to: { name: "run-detail", params: { id: item.nativeKey } },
    };
  }
  if (item.attention === "blocked" && item.kind === "run" && item.nativeKey) {
    return {
      id: "open-run",
      label: "Open run",
      kind: "route",
      to: { name: "run-detail", params: { id: item.nativeKey } },
    };
  }
  if (item.attention === "stale" && item.sourceId && item.nativeKey) {
    return { id: "recheck-item", label: "Recheck now", kind: "action" };
  }
  if (item.attention === "sync-error" && item.sourceId) {
    return { id: "retry-source", label: "Retry source", kind: "action" };
  }
  const href = workExternalHref(item, sourceWebUrl);
  if (href) {
    return { id: "open-source", label: "Open in source", kind: "href", href };
  }
  return null;
}

export function attentionMenuItems(
  item: WorkItem,
  sourceWebUrl?: string | null,
): AttentionMenuItem[] {
  const items: AttentionMenuItem[] = [];
  const href = workExternalHref(item, sourceWebUrl);
  if (href) {
    items.push({
      id: "open-source",
      label: "Open in source",
    });
  }
  if (item.kind === "run" && item.nativeKey) {
    items.push({
      id: "open-run",
      label: "Open run",
      to: { name: "run-detail", params: { id: item.nativeKey } },
    });
  }
  if (item.sourceId && item.nativeKey && item.attention === "stale") {
    items.push({ id: "recheck-item", label: "Recheck now" });
  }
  if (item.sourceId && item.attention === "sync-error") {
    items.push({ id: "retry-source", label: "Retry source" });
  }
  if (item.attention === "stale" || item.attention === "sync-error") {
    items.push({ id: "resolve", label: "Mark resolved", danger: true });
  }
  return items;
}

export function attentionReasonLabel(attention: WorkAttention): string {
  switch (attention) {
    case "approval":
      return "Awaiting approval";
    case "blocked":
      return "Blocked";
    case "sync-error":
      return "Source sync error";
    case "stale":
      return "Stale observation";
    default:
      return attention;
  }
}
