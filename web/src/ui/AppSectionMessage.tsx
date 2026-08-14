import type { ReactNode } from "react";
import SectionMessage from "@atlaskit/section-message";

export type AppSectionMessageAppearance = "error" | "info" | "success" | "warning";

function adsAppearance(
  appearance: AppSectionMessageAppearance,
): "error" | "information" | "success" | "warning" {
  if (appearance === "info") return "information";
  return appearance;
}

export type AppSectionMessageProps = {
  appearance: AppSectionMessageAppearance;
  title?: string;
  children: ReactNode;
  className?: string;
};

/**
 * ADS SectionMessage with explicit heading level and gojo alert appearance names.
 * Use instead of raw `@atlaskit/section-message` or `.alert` divs in views.
 */
export function AppSectionMessage({
  appearance,
  title,
  children,
  className,
}: AppSectionMessageProps) {
  const body = typeof children === "string" ? <p>{children}</p> : children;
  const rootClass = ["app-section-message", className].filter(Boolean).join(" ");

  const message = title ? (
    <SectionMessage appearance={adsAppearance(appearance)} title={title} headingLevel="h2">
      {body}
    </SectionMessage>
  ) : (
    <SectionMessage appearance={adsAppearance(appearance)}>{body}</SectionMessage>
  );

  return (
    <div className={rootClass} style={{ marginBottom: "var(--space-5)" }}>
      {message}
    </div>
  );
}
