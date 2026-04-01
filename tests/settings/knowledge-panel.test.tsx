// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgePanel } from "@/components/settings/KnowledgePanel";

afterEach(() => {
  cleanup();
});

describe("knowledge panel preview search", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("filters preview chunks and keeps matching text visible", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          summary: {
            enabled: true,
            folder: "knowledge",
            absolutePath: "C:/workspace/knowledge",
            exists: true,
            lastIndexedAt: null,
            indexedFileCount: 1,
            indexedChunkCount: 2,
            pendingFileCount: 0,
            skippedFileCount: 0,
            totalFileCount: 1,
          },
          files: [
            {
              path: "knowledge/faq.md",
              name: "faq.md",
              extension: ".md",
              size: 1200,
              modifiedAt: "2026-04-01T10:00:00.000Z",
              status: "indexed",
              indexedChunks: 2,
              skipReason: null,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          preview: {
            path: "knowledge/faq.md",
            indexed: true,
            status: "indexed",
            chunkCount: 2,
            snippetCount: 2,
            updatedAt: "2026-04-01T10:00:00.000Z",
            chunks: [
              { index: 0, source: "indexed", snippet: "Returns and refund policy for orders placed online." },
              { index: 1, source: "indexed", snippet: "Store hours and pickup windows for weekend visits." },
            ],
          },
        }),
      });

    vi.stubGlobal("fetch", fetchMock);

    render(<KnowledgePanel />);

    await waitFor(() => {
      expect(screen.getByText("knowledge/faq.md")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "preview" }));

    await waitFor(() => {
      expect(screen.getByText("search preview")).toBeTruthy();
      expect(screen.getByText(/Returns and refund policy/i)).toBeTruthy();
      expect(screen.getByText(/Store hours and pickup windows/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText("Filter chunks by text"), {
      target: { value: "refund" },
    });

    expect(screen.getByText("refund")).toBeTruthy();
    expect(screen.queryByText(/Store hours and pickup windows/i)).toBeNull();
    expect(screen.getByText(/1 of/i)).toBeTruthy();
  });

  it("navigates between repeated matches inside the same chunk", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          summary: {
            enabled: true,
            folder: "knowledge",
            absolutePath: "C:/workspace/knowledge",
            exists: true,
            lastIndexedAt: null,
            indexedFileCount: 1,
            indexedChunkCount: 1,
            pendingFileCount: 0,
            skippedFileCount: 0,
            totalFileCount: 1,
          },
          files: [
            {
              path: "knowledge/repeat.md",
              name: "repeat.md",
              extension: ".md",
              size: 1200,
              modifiedAt: "2026-04-01T10:00:00.000Z",
              status: "indexed",
              indexedChunks: 1,
              skipReason: null,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          preview: {
            path: "knowledge/repeat.md",
            indexed: true,
            status: "indexed",
            chunkCount: 1,
            snippetCount: 1,
            updatedAt: "2026-04-01T10:00:00.000Z",
            chunks: [
              { index: 0, source: "indexed", snippet: "Refund policy, refund timeline, refund exceptions." },
            ],
          },
        }),
      });

    vi.stubGlobal("fetch", fetchMock);

    render(<KnowledgePanel />);

    await waitFor(() => {
      expect(screen.getByText("knowledge/repeat.md")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "preview" }));

    await waitFor(() => {
      expect(screen.getByText("search preview")).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText("Filter chunks by text"), {
      target: { value: "refund" },
    });

    await waitFor(() => {
      expect(screen.getByText(/1 \/ 3 matches/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Next match in chunk 0" }));

    expect(screen.getByText(/2 \/ 3 matches/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Previous match in chunk 0" }));

    expect(screen.getByText(/1 \/ 3 matches/i)).toBeTruthy();
  });
});