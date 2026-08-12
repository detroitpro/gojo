import Select, { type OptionType, type SelectProps, type StylesConfig } from "@atlaskit/select";

const MENU_Z = 9999;

const portalStyles: StylesConfig<OptionType> = {
  menuPortal: (base) => ({ ...base, zIndex: MENU_Z }),
};

/**
 * Atlaskit Select with menu portaled to document.body so sticky table headers,
 * overflow:auto shells, and other stacking contexts cannot cover the list.
 * Defaults to ADS compact spacing (32px) so selects align with AppButton md.
 */
export function AppSelect<Option extends OptionType = OptionType, IsMulti extends boolean = false>(
  props: SelectProps<Option, IsMulti>,
) {
  const { styles, menuPortalTarget, menuPosition, spacing, ...rest } = props;
  const target =
    menuPortalTarget !== undefined
      ? menuPortalTarget
      : typeof document !== "undefined"
        ? document.body
        : null;

  return (
    <Select<Option, IsMulti>
      {...rest}
      spacing={spacing ?? "compact"}
      menuPortalTarget={target}
      menuPosition={menuPosition ?? "fixed"}
      styles={
        {
          ...portalStyles,
          ...styles,
          menuPortal: (base, state) => {
            const fromPortal = portalStyles.menuPortal?.(base, state) ?? base;
            const fromCaller = styles?.menuPortal?.(fromPortal, state);
            return fromCaller ?? fromPortal;
          },
        } as StylesConfig<Option, IsMulti>
      }
    />
  );
}

export type { OptionType, SelectProps, StylesConfig };
export default AppSelect;
