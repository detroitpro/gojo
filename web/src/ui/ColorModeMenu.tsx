import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSetColorMode } from "@atlaskit/app-provider";
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

type PanelStyle = { top: string; left: string };

function placePanel(rect: DOMRect, menuWidth: number, menuHeight: number): PanelStyle {
  const gap = 6;
  const pad = 8;

  let left = rect.right + gap;
  if (left + menuWidth > window.innerWidth - pad) {
    left = Math.max(pad, rect.left - gap - menuWidth);
  }

  let top = rect.top;
  if (top + menuHeight > window.innerHeight - pad) {
    top = Math.max(pad, window.innerHeight - pad - menuHeight);
  }

  return {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
  };
}

export function ColorModeMenu() {
  const setColorMode = useSetColorMode();
  const [preference, setPreference] = useState<ColorModePreference>(() => readStoredColorMode());
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<PanelStyle>({ top: "0px", left: "0px" });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const active = OPTIONS.find((o) => o.id === preference) ?? OPTIONS[0]!;
  const TriggerIcon = active.Icon;

  const close = useCallback(() => setOpen(false), []);

  const positionPanel = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setPanelStyle(placePanel(rect, 160, 140));
    requestAnimationFrame(() => {
      const el = panelRef.current;
      if (!el || !triggerRef.current) return;
      const next = triggerRef.current.getBoundingClientRect();
      setPanelStyle(placePanel(next, el.offsetWidth, el.offsetHeight));
    });
  }, []);

  const choose = useCallback(
    (mode: ColorModePreference) => {
      writeStoredColorMode(mode);
      setPreference(mode);
      setColorMode(mode);
      close();
    },
    [setColorMode, close],
  );

  useLayoutEffect(() => {
    if (open) positionPanel();
  }, [open, positionPanel]);

  useEffect(() => {
    if (!open) return;

    function onDocClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      close();
    }

    function onKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }

    function onReposition() {
      positionPanel();
    }

    document.addEventListener("click", onDocClick);
    window.addEventListener("keydown", onKeydown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("click", onDocClick);
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, close, positionPanel]);

  return (
    <div ref={rootRef} className="color-mode-menu">
      <button
        type="button"
        className={`nav-link${open ? " active" : ""}`}
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Color mode: ${active.label}`}
        title={`Theme: ${active.label}`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((wasOpen) => !wasOpen);
        }}
      >
        <TriggerIcon className="nav-icon" size={18} aria-hidden="true" />
        <span className="nav-label">Theme</span>
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              className="action-menu-panel action-menu-panel-floating color-mode-menu-panel"
              role="menu"
              aria-label="Color mode"
              style={panelStyle}
            >
              <div className="color-mode-menu-title">Color mode</div>
              {OPTIONS.map((opt) => {
                const selected = preference === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={`action-menu-item${selected ? " selected" : ""}`}
                    onClick={() => choose(opt.id)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
