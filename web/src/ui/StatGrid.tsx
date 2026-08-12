import type { ReactNode } from "react";

export function StatGrid({
  title,
  children,
  className,
}: {
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={["stat-grid-wrap", className].filter(Boolean).join(" ")}>
      {title ? <div className="stat-grid__title">{title}</div> : null}
      <div className="stat-grid">{children}</div>
    </div>
  );
}
