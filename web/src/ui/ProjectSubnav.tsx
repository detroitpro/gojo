import type { LucideIcon } from "lucide-react";
import { useLocation } from "react-router-dom";

import { AppButton } from "@/ui/AppButton";

export type ProjectSubnavItem = {
  name: string;
  label: string;
  to: string;
  icon: LucideIcon;
};

export function ProjectSubnav({ items }: { items: ProjectSubnavItem[] }) {
  const location = useLocation();

  return (
    <nav className="filter-bar mb-7" aria-label="Project sections">
      <div className="btn-row subnav">
        {items.map((item) => {
          const active =
            location.pathname === item.to ||
            location.pathname.startsWith(`${item.to}/`);
          return (
            <AppButton
              key={item.name}
              to={item.to}
              variant="ghost"
              selected={active}
              iconBefore={<item.icon size={16} aria-hidden="true" />}
            >
              {item.label}
            </AppButton>
          );
        })}
      </div>
    </nav>
  );
}
