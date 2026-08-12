import { Link } from "react-router-dom";

import type { CompletedWorkPresentation } from "@/kernel/project-overview";
import { impactCategoryLabel } from "@/kernel/impact-format";
import { WorkKindBadge } from "@/ui/status/WorkKindBadge";
import { WorkResultBadge } from "@/ui/status/WorkResultBadge";

export type ChangeRowVariant = "compact" | "detailed";

const CHIP_LIMIT: Record<ChangeRowVariant, number> = {
  compact: 2,
  detailed: 6,
};

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString();
}

export function ChangeRow({
  item,
  categories = [],
  variant = "compact",
}: {
  item: CompletedWorkPresentation;
  categories?: string[];
  variant?: ChangeRowVariant;
}) {
  const maxChips = CHIP_LIMIT[variant];
  const visible = categories.slice(0, maxChips);
  const extra = Math.max(0, categories.length - maxChips);
  const secondaryLine =
    [item.agentLabel, item.description]
      .filter((part): part is string => Boolean(part?.trim()))
      .join(" · ") || null;
  const timeLabel = variant === "detailed" ? formatWhen(item.completedAt) : item.clockTime;

  return (
    <tr className={`change-row change-row--${variant}`}>
      <td className="change-row__status" title={item.statusLabel}>
        <WorkResultBadge item={item.resultItem} />
      </td>
      <td className="change-row__main">
        {item.runId ? (
          <Link to={`/runs/${item.runId}`} className="change-row__title">
            {item.outcomeTitle}
          </Link>
        ) : item.externalUrl ? (
          <a
            href={item.externalUrl}
            className="change-row__title"
            target="_blank"
            rel="noopener noreferrer"
          >
            {item.outcomeTitle}
          </a>
        ) : (
          <span className="change-row__title">{item.outcomeTitle}</span>
        )}
        {secondaryLine ? (
          <p className="change-row__secondary muted">{secondaryLine}</p>
        ) : null}
      </td>
      {variant === "detailed" ? (
        <td className="change-row__kind">
          <WorkKindBadge kind={item.kind} />
        </td>
      ) : null}
      <td className="change-row__chips">
        <div className="change-row__chips-inner">
          {visible.map((category) => (
            <span key={category} className="badge badge-neutral">
              {impactCategoryLabel(category)}
            </span>
          ))}
          {extra > 0 ? <span className="badge badge-neutral">+{extra}</span> : null}
          {item.prRef?.url ? (
            <a
              href={item.prRef.url}
              className="badge badge-neutral change-row__pr mono"
              target="_blank"
              rel="noopener noreferrer"
            >
              {item.prRef.label}
            </a>
          ) : item.prRef ? (
            <span className="badge badge-neutral change-row__pr mono">
              {item.prRef.label}
            </span>
          ) : null}
        </div>
      </td>
      {variant === "detailed" ? (
        <td className="change-row__source muted">{item.sourceLabel ?? "—"}</td>
      ) : null}
      <td className="change-row__time">
        <time
          className="mono muted"
          dateTime={item.completedAt ?? undefined}
          title={item.completedRelative}
        >
          {timeLabel}
        </time>
      </td>
    </tr>
  );
}
