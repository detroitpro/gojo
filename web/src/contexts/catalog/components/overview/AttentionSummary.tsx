import { useMemo } from "react";
import { AlertTriangle, ExternalLink, Play, RefreshCw } from "lucide-react";

import type { WorkItem } from "@/contexts/work/contract";
import {
  attentionMenuItems,
  attentionPrimaryAction,
  workExternalHref,
} from "@/kernel/work-attention";
import { presentAttentionItem } from "@/kernel/project-overview";
import { ActionMenu } from "@/ui/ActionMenu";
import { AppButton } from "@/ui/AppButton";
import { UiIcon } from "@/ui/UiIcon";
import { AttentionBadge } from "@/ui/status/AttentionBadge";

export type AttentionSummaryProps = {
  items: WorkItem[];
  sourceWebUrls: Map<string, string | null>;
  busyId?: string;
  onPrimaryAction: (item: WorkItem) => void;
  onMenuAction: (item: WorkItem, actionId: string) => void;
};

export function AttentionSummary({
  items,
  sourceWebUrls,
  busyId,
  onPrimaryAction,
  onMenuAction,
}: AttentionSummaryProps) {
  const presented = useMemo(() => items.map((item) => presentAttentionItem(item)), [items]);

  function sourceUrl(item: WorkItem): string | null {
    if (!item.sourceId) return null;
    return sourceWebUrls.get(item.sourceId) ?? null;
  }

  if (presented.length === 0) {
    return null;
  }

  return (
    <section className="attention-summary" aria-labelledby="attention-heading">
      <div className="attention-summary__header">
        <UiIcon icon={AlertTriangle} size={18} className="attention-summary__icon" />
        <h2 id="attention-heading">Needs your attention</h2>
        <span className="list-section__meta">{presented.length}</span>
      </div>
      <ul className="attention-summary__list">
        {presented.map((row) => {
          const primary = attentionPrimaryAction(row.item, sourceUrl(row.item));
          const href = workExternalHref(row.item, sourceUrl(row.item));
          return (
            <li key={row.id} className="attention-summary__item">
              <div className="attention-summary__body">
                <div className="attention-summary__title-row">
                  {href ? (
                    <a
                      href={href}
                      className="entity-name"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {row.title}
                    </a>
                  ) : (
                    <span className="entity-name">{row.title}</span>
                  )}
                  <AttentionBadge attention={row.item.attention} showLabel />
                </div>
                <p className="muted text-sm">{row.why}</p>
                <p className="muted text-sm">
                  {row.sinceLabel} · {row.expectedAction}
                </p>
              </div>
              <div className="attention-summary__actions">
                {primary?.kind === "route" ? (
                  <AppButton
                    variant="primary"
                    size="sm"
                    to={primary.to}
                    iconBefore={<Play size={12} />}
                  >
                    {primary.label}
                  </AppButton>
                ) : primary?.kind === "href" ? (
                  <AppButton
                    size="sm"
                    href={primary.href}
                    target="_blank"
                    iconBefore={<ExternalLink size={12} />}
                  >
                    {primary.label}
                  </AppButton>
                ) : primary?.kind === "action" ? (
                  <AppButton
                    variant="primary"
                    size="sm"
                    loading={busyId === row.id}
                    loadingLabel="Working…"
                    onClick={() => onPrimaryAction(row.item)}
                    iconBefore={<RefreshCw size={12} />}
                  >
                    {primary.label}
                  </AppButton>
                ) : null}
                <ActionMenu
                  items={attentionMenuItems(row.item, sourceUrl(row.item))}
                  disabled={busyId === row.id}
                  label={`Actions for ${row.title}`}
                  onSelect={(id) => onMenuAction(row.item, id)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
