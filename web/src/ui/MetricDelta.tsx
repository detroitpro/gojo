import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { UiIcon } from "@/ui/UiIcon";
import { deltaTone, formatDelta, type MetricDirection } from "@/kernel/stat-metrics";
import { badgeToneClass } from "@/kernel/status-icons";

export type MetricDeltaProps = {
  delta: number | null;
  direction: MetricDirection;
  title?: string;
};

export function MetricDelta({ delta, direction, title }: MetricDeltaProps) {
  if (delta === null) return null;
  const toneClass = badgeToneClass(deltaTone({ direction }, delta));
  const Icon = delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const label = formatDelta(delta);

  return (
    <span
      className={`metric-delta ${toneClass}`}
      title={title}
      aria-label={title ? `${label} ${title}` : label}
    >
      <UiIcon icon={Icon} size={12} />
      <span className="metric-delta__value">{label}</span>
    </span>
  );
}
