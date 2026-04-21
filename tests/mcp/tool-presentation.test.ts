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

  it("distinguishes Creeper read-only versus mutating tools", () => {
    expect(getToolAnnotations("creeper_get_company_profile")).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });

    expect(getToolAnnotations("creeper_register_source")).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });

    expect(getToolAnnotations("creeper_profile_source")).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it("describes Creeper profiling and mutation surfaces with the correct safety hints", () => {
    expect(getToolDescription("creeper_register_source", "Register a read-only Postgres company source.")).toContain("Changes external or persisted state.");
    expect(getToolDescription("creeper_profile_source", "Run bounded Postgres schema profiling.")).toContain("Reads an external company source while also persisting local Creeper state and audit artifacts.");
    expect(getToolDescription("creeper_get_company_profile", "Return one company profile.")).toContain("Read-only.");
  });
});