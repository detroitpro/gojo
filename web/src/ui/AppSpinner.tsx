import Spinner from "@atlaskit/spinner";

export type AppSpinnerSize = "small" | "medium" | "large" | "xlarge";

export type AppSpinnerProps = {
  size?: AppSpinnerSize;
  label?: string;
};

/** Atlaskit Spinner — use instead of importing `@atlaskit/spinner` in views. */
export function AppSpinner({ size = "medium", label }: AppSpinnerProps) {
  return <Spinner size={size} label={label} />;
}
