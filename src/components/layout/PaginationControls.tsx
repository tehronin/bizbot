interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  startItem: number;
  endItem: number;
  totalItems: number;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
}

export function PaginationControls({
  currentPage,
  totalPages,
  startItem,
  endItem,
  totalItems,
  setCurrentPage,
}: PaginationControlsProps) {
  if (totalItems === 0) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-4 border-t pt-3" style={{ borderColor: "var(--border-sub)" }}>
      <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>
        showing {startItem}-{endItem} of {totalItems}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
          disabled={currentPage === 1}
          className="px-3 py-2 border text-xs uppercase tracking-[0.16em] disabled:opacity-40"
          style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
        >
          prev
        </button>
        <div className="min-w-24 text-center text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
          page {currentPage} / {totalPages}
        </div>
        <button
          onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
          disabled={currentPage === totalPages}
          className="px-3 py-2 border text-xs uppercase tracking-[0.16em] disabled:opacity-40"
          style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
        >
          next
        </button>
      </div>
    </div>
  );
}