"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;

  return {
    currentPage,
    totalPages,
    startItem: totalItems === 0 ? 0 : startIndex + 1,
    endItem: Math.min(endIndex, totalItems),
    pageItems: items.slice(startIndex, endIndex),
    totalItems,
    setCurrentPage,
  };
}