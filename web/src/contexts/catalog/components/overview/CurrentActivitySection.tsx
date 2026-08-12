import { useMemo } from "react";
import { Link } from "react-router-dom";

import type { WorkItem } from "@/contexts/work/contract";
import {
  executionStageLabel,
  formatRelativeTime,
  isActiveWork,
} from "@/kernel/project-overview";
import {
  workAgentProfileLabel,
  workPrimaryLabel,
  workSecondaryLabel,
} from "@/kernel/work-display";
import { ExecutionBadge } from "@/ui/status/ExecutionBadge";

export function CurrentActivitySection({ items }: { items: WorkItem[] }) {
  const active = useMemo(() => items.filter(isActiveWork), [items]);
  if (active.length === 0) return null;

  return (
    <section className="current-activity" aria-labelledby="current-activity-heading">
      <div className="list-section__header">
        <h2 id="current-activity-heading" className="list-section__title">
          In progress
        </h2>
        <span className="list-section__meta">{active.length}</span>
      </div>
      <ul className="current-activity__list">
        {active.map((item) => (
          <li key={item.id} className="current-activity__item">
            <div>
              {item.kind === "run" && item.nativeKey ? (
                <Link to={`/runs/${item.nativeKey}`} className="entity-name">
                  {item.title || workPrimaryLabel(item)}
                </Link>
              ) : item.webUrl ? (
                <a
                  href={item.webUrl}
                  className="entity-name"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.title || workPrimaryLabel(item)}
                </a>
              ) : (
                <span className="entity-name">{item.title || workPrimaryLabel(item)}</span>
              )}
              {workSecondaryLabel(item) ? (
                <p className="muted text-sm">{workSecondaryLabel(item)}</p>
              ) : null}
              <p className="muted text-sm current-activity__meta">
                <ExecutionBadge execution={item.execution} showLabel />
                <span>{executionStageLabel(item.execution)}</span>
                <span aria-hidden="true">·</span>
                <span>Started {formatRelativeTime(item.startedAt ?? item.createdAt)}</span>
                <span aria-hidden="true">·</span>
                <span>Agent: {workAgentProfileLabel(item)}</span>
              </p>
            </div>
            {item.kind === "run" && item.nativeKey ? (
              <Link to={`/runs/${item.nativeKey}`} className="text-sm">
                View live run
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
