import { test, expect } from "@playwright/test";

test.describe("Setup Agent", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("chat panel is visible by default", async ({ page }) => {
    // The hub chat panel should be open on load
    const chatPanel = page.locator(".hub-chat");
    await expect(chatPanel).toBeVisible();

    // It should contain the "Setup Agent" title
    const title = chatPanel.locator(".hub-chat-title");
    await expect(title).toHaveText("Setup Agent");

    // The composer textarea should be present
    const composer = chatPanel.locator(".chat-composer textarea");
    await expect(composer).toBeVisible();
  });

  test("can send a message to the Setup Agent", async ({ page }) => {
    const composer = page.locator(".hub-chat .chat-composer textarea");
    await expect(composer).toBeVisible();

    // Type a message
    await composer.fill("Hello, Setup Agent!");
    await expect(composer).toHaveValue("Hello, Setup Agent!");

    // Click send
    const sendBtn = page.locator(".hub-chat .chat-composer .send-btn");
    await sendBtn.click();

    // The user message should appear in the chat
    const userMessage = page.locator(
      ".hub-chat .chat-message-user .message-content"
    );
    await expect(userMessage.first()).toHaveText("Hello, Setup Agent!");

    // In dev mode, an assistant reply should appear after a short delay
    const assistantMessage = page.locator(
      ".hub-chat .chat-message-assistant .message-content"
    );
    await expect(assistantMessage.first()).toBeVisible({ timeout: 5000 });
  });

  test("model picker opens and shows models", async ({ page }) => {
    // Click the model picker trigger button in the titlebar
    const modelTrigger = page.locator(".model-picker-trigger").first();
    await expect(modelTrigger).toBeVisible();
    await modelTrigger.click();

    // The dropdown should appear
    const dropdown = page.locator(".model-picker-dropdown").first();
    await expect(dropdown).toBeVisible();

    // It should show provider groups (Claude, Codex)
    const groupHeaders = dropdown.locator(".model-group-header");
    await expect(groupHeaders).toHaveCount(2);

    // Click on the Claude group to expand it
    const claudeGroup = groupHeaders.filter({ hasText: "Claude" });
    await claudeGroup.click();

    // Should show Claude models, biggest first
    const claudeModels = dropdown.locator(
      ".model-group-models .model-option-label"
    );
    await expect(claudeModels.first()).toContainText("Opus 4.6");
  });

  test("thinking mode picker works", async ({ page }) => {
    // The effort/thinking trigger is the second model-picker-trigger
    const effortTrigger = page.locator(".model-picker-effort-trigger");
    await expect(effortTrigger).toBeVisible();

    // It should default to "High"
    await expect(effortTrigger).toContainText("High");

    // Click to open the dropdown
    await effortTrigger.click();

    const dropdown = page.locator(".model-picker-effort-dropdown");
    await expect(dropdown).toBeVisible();

    // Should show thinking level options
    const options = dropdown.locator(".model-option");
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Select "Low"
    const lowOption = options.filter({ hasText: "Low" });
    await lowOption.click();

    // Dropdown should close and label should update
    await expect(dropdown).not.toBeVisible();
    await expect(effortTrigger).toContainText("Low");
  });
});
