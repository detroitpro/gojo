import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { MetricDelta } from "@/ui/MetricDelta";
import { UiIcon } from "@/ui/UiIcon";
import { formatMergeRate } from "@/kernel/impact-format";
import {
  impactCategorySpec,
  METRICS,
  metricAriaLabel,
  metricDelta,
  metricTone,
} from "@/kernel/stat-metrics";

const IMPACT_CATEGORY_PREFIX = "impact.category.";

export type StatTileProps = {
  metricKey: string;
  value: string | number | null;
  previous?: number | null;
  compareLabel?: string;
  to?: string;
  href?: string;
};

export function StatTile({ metricKey, value, previous, compareLabel, to, href }: StatTileProps) {
  const spec = useMemo(() => {
    if (metricKey.startsWith(IMPACT_CATEGORY_PREFIX)) {
      return impactCategorySpec(metricKey.slice(IMPACT_CATEGORY_PREFIX.length));
    }
    return METRICS[metricKey];
  }, [metricKey]);

  const numericValue = typeof value === "number" ? value : null;

  const displayValue = useMemo(() => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "string") return value;
    if (spec?.kind === "ratio") return formatMergeRate(value);
    return String(value);
  }, [value, spec]);

  const delta = numericValue === null ? null : metricDelta(numericValue, previous);
  const tone = spec ? metricTone(spec, numericValue ?? value ?? 0) : "neutral";
  const showAttentionFlag = spec?.attention && numericValue !== null && numericValue > 0;
  const ariaLabel = spec
    ? metricAriaLabel(spec, displayValue, delta, compareLabel)
    : displayValue;

  const className = `stat-tile stat-tile--${tone}`;
  const content: ReactNode = (
    <>
      {showAttentionFlag ? <span className="stat-tile__flag" aria-hidden="true" /> : null}
      <div className="stat-tile__header">
        <span className="stat-tile__icon" aria-hidden="true">
          {spec ? <UiIcon icon={spec.icon} size={16} /> : null}
        </span>
        <span className="stat-tile__label">{spec?.label ?? metricKey}</span>
      </div>
      <span className="stat-tile__value">{displayValue}</span>
      {spec && delta !== null ? (
        <MetricDelta delta={delta} direction={spec.direction} title={compareLabel} />
      ) : null}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={className} aria-label={ariaLabel} title={spec?.hint}>
        {content}
      </Link>
    );
  }
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        aria-label={ariaLabel}
        title={spec?.hint}
      >
        {content}
      </a>
    );
  }
  return (
    <div className={className} aria-label={ariaLabel} title={spec?.hint}>
      {content}
    </div>
  );
}
