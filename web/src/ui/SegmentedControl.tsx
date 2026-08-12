import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type SegmentedItem<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  count?: number | null;
};

export type SegmentedControlProps<T extends string> = {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
};

function segmentLabel(item: SegmentedItem<string>): string {
  if (item.count == null) return item.label;
  return `${item.label} (${item.count})`;
}

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function focusIndex(index: number) {
    const el = refs.current[index];
    el?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (items.length === 0) return;
    const current = items.findIndex((item) => item.value === value);
    const base = current < 0 ? 0 : current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = (base + 1) % items.length;
      onChange(items[next]!.value);
      focusIndex(next);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const prev = (base - 1 + items.length) % items.length;
      onChange(items[prev]!.value);
      focusIndex(prev);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      onChange(items[0]!.value);
      focusIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      const last = items.length - 1;
      onChange(items[last]!.value);
      focusIndex(last);
    }
  }

  return (
    <div className="segmented" role="group" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            className={`segmented__item${selected ? " is-selected" : ""}`}
            aria-pressed={selected}
            aria-label={segmentLabel(item)}
            tabIndex={selected ? 0 : -1}
            ref={(el) => {
              refs.current[index] = el;
            }}
            onClick={() => onChange(item.value)}
          >
            {item.icon ? <span className="segmented__icon">{item.icon}</span> : null}
            <span>{item.label}</span>
            {item.count != null ? <span className="segmented__count">{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
