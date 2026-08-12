import { ChevronLeft, ChevronRight } from "lucide-react";

import { AppButton } from "@/ui/AppButton";

export type TablePagerProps =
  | {
      /** Offset-based API for React server-table hooks. */
      offset: number;
      limit: number;
      total: number;
      onPrev: () => void;
      onNext: () => void;
      loading?: boolean;
    }
  | {
      /** Page-based API for the classic useServerTable / useClientPager. */
      page: number;
      pageCount: number;
      rangeLabel: string;
      total: number;
      onPageChange: (page: number) => void;
      loading?: boolean;
    };

function isOffsetProps(
  props: TablePagerProps,
): props is Extract<TablePagerProps, { offset: number }> {
  return "offset" in props;
}

export function TablePager(props: TablePagerProps) {
  if (isOffsetProps(props)) {
    const { offset, limit, total, onPrev, onNext, loading } = props;
    const from = total === 0 ? 0 : offset + 1;
    const to = Math.min(offset + limit, total);
    const canPrev = offset > 0;
    const canNext = offset + limit < total;

    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 12,
        }}
      >
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
          {total === 0 ? "No results" : `${from}–${to} of ${total}`}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <AppButton
            variant="ghost"
            size="sm"
            disabled={!canPrev || loading}
            onClick={onPrev}
            iconBefore={<ChevronLeft size={12} aria-hidden="true" />}
          >
            Previous
          </AppButton>
          <AppButton
            variant="ghost"
            size="sm"
            disabled={!canNext || loading}
            onClick={onNext}
            iconBefore={<ChevronRight size={12} aria-hidden="true" />}
          >
            Next
          </AppButton>
        </div>
      </div>
    );
  }

  const { page, pageCount, rangeLabel, total, onPageChange, loading } = props;
  if (total <= 0) return null;
  return (
    <div className="table-pager">
      <span className="muted">{rangeLabel}</span>
      <div className="table-pager-nav">
        <AppButton
          size="sm"
          disabled={page <= 1 || loading}
          aria-label="Previous page"
          onClick={() => onPageChange(page - 1)}
          iconBefore={<ChevronLeft size={12} aria-hidden="true" />}
        >
          Prev
        </AppButton>
        <span className="muted">
          Page {page} / {pageCount}
        </span>
        <AppButton
          size="sm"
          disabled={page >= pageCount || loading}
          aria-label="Next page"
          onClick={() => onPageChange(page + 1)}
          iconBefore={<ChevronRight size={12} aria-hidden="true" />}
        >
          Next
        </AppButton>
      </div>
    </div>
  );
}
