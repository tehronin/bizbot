import { expect, test } from "@playwright/test";

test.describe("oracle chat flow", () => {
  test("runs the explicit Oracle prediction path from chat", async ({ page }) => {
    await page.goto("/chat");

    await expect(page.getByText("loading chat")).not.toBeVisible();

    await page.getByRole("button", { name: "New Chat" }).click();

    const input = page.getByTestId("chat-input");
    await input.fill("oracle predict btc over 150k this year");

    await page.getByRole("button", { name: "Ask" }).click();

    await expect(input).toHaveValue("");
    await expect(page.getByRole("combobox").nth(1)).toHaveValue("oracle");

    const assistantMessage = page.getByTestId("chat-message-assistant").last();
    await expect(assistantMessage).toBeVisible();

    const assistantText = (await assistantMessage.textContent()) ?? "";
    expect(assistantText.length).toBeGreaterThan(80);
    expect(assistantText).not.toMatch(/Rihanna|GTA\s*VI/i);
  });
});