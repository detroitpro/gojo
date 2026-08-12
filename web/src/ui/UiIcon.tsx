import type { LucideIcon } from "lucide-react";

export type UiIconProps = {
  icon: LucideIcon;
  size?: number;
  strokeWidth?: number;
  className?: string;
};

export function UiIcon({ icon: Icon, size = 14, strokeWidth = 2, className }: UiIconProps) {
  return <Icon size={size} strokeWidth={strokeWidth} aria-hidden="true" className={className} />;
}
