import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { builderHttpRequest } from "@/lib/builder/http";

function createTempBuilderWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-builder-http-"));
}

afterEach(() => {
  delete process.env.BIZBOT_BUILDER_WORKSPACE_PATH;
  delete process.env.BIZBOT_BUILDER_ALLOWED_HOSTS;
  vi.unstubAllGlobals();
});

describe("builder http", () => {
  it("performs allowlisted HTTP probes with env-backed auth and audit logs", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    process.env.BIZBOT_BUILDER_ALLOWED_HOSTS = "api.example.com";
    fs.mkdirSync(path.join(workspaceRoot, "projects", "demo"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "projects", "demo", ".env.local"), "API_TOKEN=topsecret\n", "utf-8");

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer topsecret", Accept: "application/json" });
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await builderHttpRequest({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      method: "GET",
      url: "https://api.example.com/v1/status",
      headers: [{ name: "Accept", value: "application/json" }],
      authEnvKey: "API_TOKEN",
      authScheme: "Bearer",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.contentType).toBe("application/json");
    expect(result.body).toContain('"ok":true');
    expect(fs.existsSync(path.join(workspaceRoot, result.auditPath))).toBe(true);
    expect(fs.readFileSync(path.join(workspaceRoot, result.auditPath), "utf-8")).toContain('"capabilityKey":"network_http"');
  });

  it("blocks non-allowlisted HTTP hosts", async () => {
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_ALLOWED_HOSTS = "api.example.com";

    await expect(builderHttpRequest({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      method: "GET",
      url: "https://forbidden.example.com/status",
    })).rejects.toThrow("Builder HTTP host is not allowlisted");
  });

  it("blocks oversized request bodies before issuing the request", async () => {
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_ALLOWED_HOSTS = "api.example.com";

    await expect(builderHttpRequest({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      method: "POST",
      url: "https://api.example.com/status",
      body: "x".repeat(2048),
      maxRequestBytes: 1024,
    })).rejects.toThrow("request body exceeds the configured limit");
  });

  it("retries transient GET failures and succeeds on a later attempt", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    process.env.BIZBOT_BUILDER_ALLOWED_HOSTS = "api.example.com";

    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await builderHttpRequest({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      method: "GET",
      url: "https://api.example.com/retry",
      retryCount: 1,
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(path.join(workspaceRoot, result.auditPath), "utf-8")).toContain('"attempts":2');
  });
});