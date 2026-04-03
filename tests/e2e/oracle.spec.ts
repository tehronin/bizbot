import { expect, test } from "@playwright/test";

test.describe("oracle chat flow", () => {
  test("runs the explicit Oracle prediction path from chat", async ({ page }) => {
    await page.goto("/chat");

    await expect(page.getByText("loading chat")).not.toBeVisible();

    await page.getByRole("button", { name: "New Chat" }).click();

    const input = page.getByTestId("chat-input");
    await input.fill("oracle predict btc over 150k this year");

    const oracleTrigger = page.getByTestId("oracle-trigger-button");
    await expect(oracleTrigger).toBeVisible();
    await oracleTrigger.click();

    await expect(input).toHaveValue("");
    await expect(page.getByTestId("oracle-mode-chip")).toContainText("Oracle mode");
    await expect(page.getByTestId("oracle-mode-chip")).toContainText("btc over 150k");
    await expect(page.getByText("oracle_analyze_prediction")).toBeVisible();

    const assistantMessage = page.getByTestId("chat-message-assistant").last();
    await expect(assistantMessage).toBeVisible();

    const assistantText = (await assistantMessage.textContent()) ?? "";
    expect(assistantText.length).toBeGreaterThan(80);
    expect(assistantText).not.toMatch(/Rihanna|GTA\s*VI/i);
  });
});