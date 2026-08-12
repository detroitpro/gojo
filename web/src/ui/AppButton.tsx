import type { ReactNode } from "react";
import Button, { LinkButton } from "@atlaskit/button/new";
import Spinner from "@atlaskit/spinner";

export type AppButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export type AppButtonProps = {
  variant?: AppButtonVariant;
  size?: "sm" | "md";
  loading?: boolean;
  loadingLabel?: string;
  disabled?: boolean;
  selected?: boolean;
  type?: "button" | "submit" | "reset";
  to?: string;
  href?: string;
  target?: string;
  rel?: string;
  form?: string;
  title?: string;
  ariaLabel?: string;
  children?: ReactNode;
  onClick?: (event: React.MouseEvent) => void;
  className?: string;
  iconBefore?: ReactNode;
};

function appearanceFor(variant: AppButtonVariant): "primary" | "default" | "danger" | "subtle" {
  switch (variant) {
    case "primary":
      return "primary";
    case "danger":
      return "danger";
    case "ghost":
      return "subtle";
    default:
      return "default";
  }
}

function sizeClass(size: "sm" | "md"): string {
  return size === "sm" ? "app-button app-button--sm" : "app-button app-button--md";
}

export function AppButton({
  variant = "secondary",
  size = "md",
  loading = false,
  loadingLabel = "",
  disabled = false,
  selected = false,
  type = "button",
  to,
  href,
  target,
  rel,
  form,
  title,
  ariaLabel,
  children,
  onClick,
  className,
  iconBefore,
}: AppButtonProps) {
  const isDisabled = disabled || loading;
  const label =
    loading && loadingLabel.trim() ? loadingLabel : children;
  const beforeNode = loading ? <Spinner size="small" /> : iconBefore;
  const before = beforeNode ? () => <>{beforeNode}</> : undefined;
  const appearance = appearanceFor(variant);
  const spacing = size === "sm" ? "compact" : "default";
  const rootClass = [sizeClass(size), className].filter(Boolean).join(" ");

  const wrap = (btn: ReactNode) => <span className={rootClass}>{btn}</span>;

  // Internal routes use LinkButton + AppProvider routerLinkComponent (href → react-router).
  // Do not pass `component={Link}` to Button — @atlaskit/button/new ignores it and leaves a
  // dead <button to="..."> that never navigates.
  const linkHref = to ?? href;
  if (linkHref != null) {
    return wrap(
      <LinkButton
        appearance={appearance}
        spacing={spacing}
        isDisabled={isDisabled}
        isSelected={selected}
        aria-label={ariaLabel}
        onClick={onClick}
        iconBefore={before}
        href={isDisabled ? "#" : linkHref}
        target={target}
        rel={rel ?? (target === "_blank" ? "noopener noreferrer" : undefined)}
      >
        {label}
      </LinkButton>,
    );
  }

  return wrap(
    <Button
      appearance={appearance}
      spacing={spacing}
      isDisabled={isDisabled}
      isSelected={selected}
      type={type}
      aria-label={ariaLabel}
      onClick={onClick}
      iconBefore={before}
      {...(form ? ({ form } as object) : {})}
      {...(title ? { title } : {})}
    >
      {label}
    </Button>,
  );
}
