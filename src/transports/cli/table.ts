import { style } from "./style";

export interface TableColumn<T> {
  key: string;
  header: string;
  width?: number;
  value: (row: T) => string;
}

function pad(text: string, width: number): string {
  if (text.length >= width) {
    return text.slice(0, width);
  }
  return text + " ".repeat(width - text.length);
}

export function formatTable<T>(rows: T[], columns: TableColumn<T>[]): string {
  if (rows.length === 0) {
    return style.dim("(none)");
  }

  const widths = columns.map((col) => {
    const contentWidth = Math.max(
      col.header.length,
      ...rows.map((row) => col.value(row).length),
    );
    return col.width ?? Math.min(Math.max(contentWidth, 4), 48);
  });

  const header = columns
    .map((col, i) => style.bold(pad(col.header, widths[i]!)))
    .join("  ");
  const separator = widths.map((w) => style.dim("-".repeat(w))).join("  ");
  const body = rows.map((row) =>
    columns.map((col, i) => pad(col.value(row), widths[i]!)).join("  "),
  );

  return [header, separator, ...body].join("\n");
}

export function printTable<T>(rows: T[], columns: TableColumn<T>[]): void {
  console.log(formatTable(rows, columns));
}

/** Key/value block for inspect views. */
export function formatKeyValue(entries: Array<[string, string | null | undefined]>): string {
  const labelWidth = Math.max(8, ...entries.map(([k]) => k.length));
  return entries
    .map(([key, value]) => {
      const label = style.dim(pad(`${key}:`, labelWidth + 1));
      const display = value == null || value === "" ? style.dim("—") : value;
      return `${label} ${display}`;
    })
    .join("\n");
}
