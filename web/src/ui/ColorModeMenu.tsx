import { useCallback, useState } from "react";
import { useSetColorMode } from "@atlaskit/app-provider";
import Button from "@atlaskit/button/new";
import DropdownMenu, {
  DropdownItemRadio,
  DropdownItemRadioGroup,
} from "@atlaskit/dropdown-menu";
import { Monitor, Moon, Sun } from "lucide-react";

import {
  type ColorModePreference,
  readStoredColorMode,
  writeStoredColorMode,
} from "@/platform/color-mode";

const OPTIONS: Array<{ id: ColorModePreference; label: string; Icon: typeof Sun }> = [
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
  { id: "auto", label: "Auto", Icon: Monitor },
];

export function ColorModeMenu() {
  const setColorMode = useSetColorMode();
  const [preference, setPreference] = useState<ColorModePreference>(() => readStoredColorMode());

  const choose = useCallback(
    (mode: ColorModePreference) => {
      writeStoredColorMode(mode);
      setPreference(mode);
      setColorMode(mode);
    },
    [setColorMode],
  );

  const active = OPTIONS.find((o) => o.id === preference) ?? OPTIONS[0]!;
  const TriggerIcon = active.Icon;

  return (
    <DropdownMenu<HTMLButtonElement>
      placement="top-start"
      trigger={({ triggerRef, ...triggerProps }) => (
        <span className="app-button app-button--sm color-mode-menu-trigger">
          <Button
            {...triggerProps}
            ref={triggerRef}
            spacing="compact"
            appearance="default"
            aria-label={`Color mode: ${active.label}`}
            iconBefore={() => <TriggerIcon size={14} aria-hidden="true" />}
          >
            Theme
          </Button>
        </span>
      )}
    >
      <DropdownItemRadioGroup id="gojo-color-mode" title="Color mode">
        {OPTIONS.map((opt) => (
          <DropdownItemRadio
            key={opt.id}
            id={opt.id}
            isSelected={preference === opt.id}
            onClick={() => choose(opt.id)}
          >
            {opt.label}
          </DropdownItemRadio>
        ))}
      </DropdownItemRadioGroup>
    </DropdownMenu>
  );
}
