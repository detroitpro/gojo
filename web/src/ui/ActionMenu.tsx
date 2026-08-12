import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";

import { AppButton } from "@/ui/AppButton";

export type ActionMenuItem = {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  to?: string;
};

export type ActionMenuProps = {
  items: ActionMenuItem[];
  disabled?: boolean;
  label?: string;
  onSelect?: (id: string) => void;
};

type PanelStyle = { top: string; left: string };

function placePanel(rect: DOMRect, menuWidth: number, menuHeight: number): PanelStyle {
  const gap = 4;
  const pad = 8;

  let top = rect.bottom + gap;
  if (top + menuHeight > window.innerHeight - pad && rect.top - gap - menuHeight >= pad) {
    top = rect.top - gap - menuHeight;
  }

  let left = rect.right - menuWidth;
  left = Math.min(left, window.innerWidth - pad - menuWidth);
  left = Math.max(pad, left);

  return {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
  };
}

export function ActionMenu({
  items,
  disabled = false,
  label = "Actions",
  onSelect,
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<PanelStyle>({ top: "0px", left: "0px" });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  const positionPanel = useCallback(() => {
    const trigger = rootRef.current?.querySelector(".action-menu-trigger");
    const rect =
      trigger instanceof HTMLElement ? trigger.getBoundingClientRect() : null;
    if (!rect) return;

    setPanelStyle(placePanel(rect, 144, 160));
    requestAnimationFrame(() => {
      const el = panelRef.current;
      if (!el) return;
      const next = trigger instanceof HTMLElement ? trigger.getBoundingClientRect() : rect;
      setPanelStyle(placePanel(next, el.offsetWidth, el.offsetHeight));
    });
  }, []);

  const toggle = useCallback(() => {
    if (disabled) return;
    setOpen((wasOpen) => {
      if (wasOpen) return false;
      return true;
    });
  }, [disabled]);

  useLayoutEffect(() => {
    if (open) positionPanel();
  }, [open, items, positionPanel]);

  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);

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

  function handleSelect(item: ActionMenuItem) {
    if (item.disabled) return;
    close();
    if (!item.to) onSelect?.(item.id);
  }

  return (
    <div ref={rootRef} className="action-menu">
      <AppButton
        className="action-menu-trigger"
        variant="ghost"
        size="sm"
        disabled={disabled}
        ariaLabel={label}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        iconBefore={<MoreHorizontal size={16} aria-hidden="true" />}
      />
      {open
        ? createPortal(
            <div
              ref={panelRef}
              className="action-menu-panel action-menu-panel-floating"
              role="menu"
              style={panelStyle}
            >
              {items.map((item) => {
                const className = `action-menu-item${item.danger ? " danger" : ""}${
                  item.disabled ? " disabled" : ""
                }`;
                if (item.to) {
                  return (
                    <Link
                      key={item.id}
                      to={item.to}
                      className={className}
                      role="menuitem"
                      onClick={() => handleSelect(item)}
                    >
                      {item.label}
                    </Link>
                  );
                }
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={className}
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => handleSelect(item)}
                  >
                    {item.label}
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
