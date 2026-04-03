import { describe, expect, it } from "vitest";
import { getToolAnnotations, getToolDescription } from "@/lib/mcp/tool-presentation";

describe("MCP tool presentation", () => {
  it("marks mutating developer worker controls as destructive", () => {
    expect(getToolAnnotations("developer_retry_worker_job")).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });

    expect(getToolAnnotations("developer_enqueue_heartbeat")).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("describes mutating developer worker controls as state-changing", () => {
    expect(getToolDescription("developer_retry_worker_job", "Retry a failed heartbeat worker job by job id.")).toContain("Changes external or persisted state.");
    expect(getToolDescription("developer_enqueue_heartbeat", "Enqueue a heartbeat job manually for immediate worker execution.")).toContain("Changes external or persisted state.");
  });
});