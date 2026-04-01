import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getKnowledgeDashboard: vi.fn(),
  getKnowledgeFilePreview: vi.fn(),
  uploadKnowledgeFiles: vi.fn(),
  reindexAllKnowledgeFiles: vi.fn(),
  reindexKnowledgeFile: vi.fn(),
  deleteKnowledgeWorkspaceFile: vi.fn(),
}));

vi.mock("@/lib/agent/knowledge-management", () => ({
  getKnowledgeDashboard: mocks.getKnowledgeDashboard,
  getKnowledgeFilePreview: mocks.getKnowledgeFilePreview,
  uploadKnowledgeFiles: mocks.uploadKnowledgeFiles,
  reindexAllKnowledgeFiles: mocks.reindexAllKnowledgeFiles,
  reindexKnowledgeFile: mocks.reindexKnowledgeFile,
  deleteKnowledgeWorkspaceFile: mocks.deleteKnowledgeWorkspaceFile,
}));

import { GET, PATCH, POST } from "@/app/api/knowledge/route";

describe("knowledge route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the knowledge dashboard", async () => {
    mocks.getKnowledgeDashboard.mockResolvedValue({ summary: { totalFileCount: 1 }, files: [] });

    const response = await GET(new NextRequest("http://localhost/api/knowledge"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getKnowledgeDashboard).toHaveBeenCalledTimes(1);
    expect(payload).toEqual({ summary: { totalFileCount: 1 }, files: [] });
  });

  it("returns a file preview when a path query is provided", async () => {
    mocks.getKnowledgeFilePreview.mockResolvedValue({ path: "knowledge/faq.md", chunks: [{ index: 0, snippet: "faq chunk", source: "indexed" }] });

    const response = await GET(new NextRequest("http://localhost/api/knowledge?path=knowledge/faq.md"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getKnowledgeFilePreview).toHaveBeenCalledWith("knowledge/faq.md");
    expect(payload.preview.path).toBe("knowledge/faq.md");
  });

  it("uploads files through multipart POST and refreshes the dashboard", async () => {
    mocks.uploadKnowledgeFiles.mockResolvedValue({ saved: [{ path: "knowledge/faq.md", overwritten: false }], rejected: [], sync: { indexed: true } });
    mocks.getKnowledgeDashboard.mockResolvedValue({ summary: { totalFileCount: 1 }, files: [{ path: "knowledge/faq.md" }] });

    const formData = new FormData();
    formData.append("files", new File(["hello"], "faq.md", { type: "text/markdown" }));
    const request = new NextRequest("http://localhost/api/knowledge", {
      method: "POST",
      body: formData,
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.uploadKnowledgeFiles).toHaveBeenCalledTimes(1);
    expect(mocks.getKnowledgeDashboard).toHaveBeenCalledTimes(1);
    expect(payload.uploaded.saved).toEqual([{ path: "knowledge/faq.md", overwritten: false }]);
    expect(payload.dashboard.summary.totalFileCount).toBe(1);
  });

  it("runs a file reindex action through PATCH", async () => {
    mocks.reindexKnowledgeFile.mockResolvedValue({ indexed: true, changedFiles: 1 });
    mocks.getKnowledgeDashboard.mockResolvedValue({ summary: { totalFileCount: 2 }, files: [] });

    const response = await PATCH(new NextRequest("http://localhost/api/knowledge", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reindex_file", path: "knowledge/faq.md" }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.reindexKnowledgeFile).toHaveBeenCalledWith("knowledge/faq.md");
    expect(payload.action).toBe("reindex_file");
    expect(payload.path).toBe("knowledge/faq.md");
  });
});