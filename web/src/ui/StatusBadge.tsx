import { toneIcon, type BadgeTone } from "@/kernel/status-icons";
import { UiIcon } from "@/ui/UiIcon";

export type StatusBadgeProps = {
  tone: BadgeTone;
  label: string;
};

/**
 * Neutral pill with a tone-colored icon.
 *
 * Deliberately not `@atlaskit/lozenge`: the legacy lozenge hardcodes theme-blind
 * fills (e.g. success `#b3df72`), and the newer lozenge ties icon color to the
 * pill tint — neither can render “neutral surface + semantic icon.”
 */
export function StatusBadge({ tone, label }: StatusBadgeProps) {
  return (
    <span className={`badge badge-neutral badge--tone-${tone}`}>
      <span className="badge__icon" aria-hidden="true">
        <UiIcon icon={toneIcon(tone)} size={12} />
      </span>
      <span className="badge__label">{label}</span>
    </span>
  );
}
