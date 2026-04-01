"use client";

import { useMemo, useState } from "react";

export interface PaginationState<T> {
  currentPage: number;
  totalPages: number;
  startItem: number;
  endItem: number;
  pageItems: T[];
  totalItems: number;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
}

export function usePagination<T>(items: T[], pageSize: number): PaginationState<T> {
  const [currentPage, setCurrentPage] = useState(1);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const updateCurrentPage: React.Dispatch<React.SetStateAction<number>> = useMemo(
    () => (value) => {
      setCurrentPage((current) => {
        const next = typeof value === "function" ? value(current) : value;
        return Math.max(1, Math.min(next, totalPages));
      });
    },
    [totalPages],
  );

  return {
    currentPage: safeCurrentPage,
    totalPages,
    startItem: totalItems === 0 ? 0 : startIndex + 1,
    endItem: Math.min(endIndex, totalItems),
    pageItems: items.slice(startIndex, endIndex),
    totalItems,
    setCurrentPage: updateCurrentPage,
  };
}