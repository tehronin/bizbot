// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageMarkdown } from "@/components/chat/MessageMarkdown";

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("MessageMarkdown", () => {
  it("renders ordered lists and inline formatting", () => {
    const { container } = render(
      <MessageMarkdown markdown={[
        "1. **Plan** the rollout",
        "2. _Review_ the metrics with `npm run test:app`",
        "3. Read [the runbook](https://example.com/runbook)",
      ].join("\n")}
      />,
    );

    const orderedList = container.querySelector("ol");
    expect(orderedList).toBeTruthy();
    expect(screen.getByText("Plan").tagName).toBe("STRONG");
    expect(screen.getByText("Review").tagName).toBe("EM");
    expect(screen.getByText("npm run test:app").tagName).toBe("CODE");
    expect(screen.getByRole("link", { name: "the runbook" }).getAttribute("href")).toBe("https://example.com/runbook");
  });

  it("preserves fenced code blocks", () => {
    render(<MessageMarkdown markdown={["```ts", 'console.log("hello")', "```"].join("\n")} />);

    expect(screen.getByText("ts")).toBeTruthy();
    expect(screen.getByText('console.log("hello")')).toBeTruthy();
  });

  it("copies code blocks with the action button", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText,
      },
    });

    const { getByTestId, getByText } = render(<MessageMarkdown markdown={["```ts", 'console.log("hello")', "```"].join("\n")} />);

    fireEvent.click(getByTestId("code-copy-0"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('console.log("hello")');
      expect(getByText("Copied")).toBeTruthy();
    });
  });

  it("shows a trailing streaming cursor when requested", () => {
    render(<MessageMarkdown markdown="Drafting now" showStreamingCursor />);

    expect(screen.getByTestId("chat-streaming-cursor")).toBeTruthy();
  });
});