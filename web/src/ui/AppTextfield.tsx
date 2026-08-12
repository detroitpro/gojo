import Textfield, { type TextFieldProps } from "@atlaskit/textfield";

/**
 * Atlaskit Textfield defaulting to isCompact (32px) so fields align with
 * AppButton md and AppSelect compact spacing. Pass isCompact={false} to opt out.
 */
export function AppTextfield({ isCompact = true, ...rest }: TextFieldProps) {
  return <Textfield isCompact={isCompact} {...rest} />;
}

export type { TextFieldProps };
export default AppTextfield;
