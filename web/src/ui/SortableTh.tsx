import type { SortOrder } from "@/kernel/pagination";

export type SortableThProps = {
  column: string;
  label: string;
  sort: string;
  order: SortOrder;
  defaultOrder?: SortOrder;
  onSort: (column: string, firstOrder: SortOrder) => void;
};

export function SortableTh({
  column,
  label,
  sort,
  order,
  defaultOrder,
  onSort,
}: SortableThProps) {
  const active = sort === column;
  const ariaSort: "ascending" | "descending" | "none" = active
    ? order === "asc"
      ? "ascending"
      : "descending"
    : "none";
  const indicator = active ? (order === "asc" ? "↑" : "↓") : "↕";

  return (
    <th aria-sort={ariaSort} className="sortable-th">
      <button
        type="button"
        className={`sortable-th__btn${active ? " is-active" : ""}`}
        onClick={() => onSort(column, defaultOrder ?? "asc")}
      >
        <span>{label}</span>
        <span className="sortable-th__ind" aria-hidden="true">
          {indicator}
        </span>
      </button>
    </th>
  );
}
