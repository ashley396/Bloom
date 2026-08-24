import { test, expect } from "@playwright/test";
import { withFakeSession, mockBackend } from "./fixtures.mjs";

/**
 * Regression coverage for the Settings page + assistant panel repair.
 * Real bugs found and fixed, each with its own assertion here:
 *
 * 1. Daisy's "Hide Daisy" / "Reduce motion" checkboxes rendered stacked
 *    (checkbox above label, both centered) instead of beside each other —
 *    a `body.bloom-rc2 label{flex-direction:column}` utility rule beat the
 *    shared `.check` class because `.check` never declared its own
 *    flex-direction. Global fix in styles.css; every `.check` checkbox in
 *    the app benefits, not just Daisy's.
 * 2. The AI Status card and the three assistant voice panels (Lily, Rose,
 *    Bud) rendered fully open by default, dominating Settings with
 *    Ollama/Bridge/model-install controls an ordinary florist never
 *    needs. Now behind <details> progressive disclosure, collapsed by
 *    default, every control still present and working once expanded.
 * 3. Voice upload copy said "Custom uploads are managed in Admin → UI
 *    Design Mode" — internal admin language shown to a florist, for a
 *    control that florist can already use directly right there.
 * 4. Settings' two-column grid stretched every card to the tallest card's
 *    row height (default `align-items: stretch`), turning a short "Shop
 *    information" card into a mostly-blank box matching its much taller
 *    neighbor. Now `align-items: start` plus reordering the naturally
 *    long Branding Center card to full width so the two columns pair
 *    more evenly (Shop information / Account & billing, ~610px each).
 * 5. Billing showed every subscription action (Upgrade, Downgrade, Pause,
 *    Resume, Reactivate, Cancel) at once, `disabled` instead of hidden
 *    when state made an action impossible — a shop already pending
 *    cancellation still saw a live "Cancel subscription" button next to
 *    "Reactivate". Actions are now state-aware: only the ones actually
 *    possible right now render at all.
 * 6. Referral Hub's loading/not-configured/error states rendered as a
 *    bare <p>, no card border or background, unlike every other Settings
 *    panel. All three states now render inside the same .panel shape.
 * 7. The assistant panel (Lily/Rose/Daisy/Bud): its <header> element's
 *    tag name collided with the app's own global `header{flex-wrap:wrap
 *    !important}` mobile rule, wrapping the theme/expand/close buttons
 *    onto a second line that crowded the persona nav below it. An empty
 *    conversation (`.lily-body` with no messages) still claimed full
 *    panel height via flex-grow, leaving a large blank rectangle. And
 *    "Expand" (`.lily-expanded`) had no effect at all above 640px wide.
 */

async function openSettings(page, { tab } = {}) {
  await page.goto("/");
  await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
  await page.evaluate(() => window.showPage && window.showPage("settingsPage"));
  await page.waitForTimeout(300);
  // Priority 13 fix: Settings was restructured into tabs (Shop/Branding/
  // AI & Assistants/Billing/Data & Migration/Florisyn — app.js's
  // data-settings-tab click handler) after this spec was first written.
  // "Shop" is the only tab active by default, so any control living on
  // another tab (Daisy's panel and the referral hub are under "Florisyn";
  // the AI status card and assistant voice panels are under "AI &
  // Assistants"; subscription actions are under "Billing") is genuinely
  // present in the DOM but CSS-hidden until that tab is clicked — a real
  // product behavior (progressive disclosure), not a bug. Tests that
  // exercise one of those controls now click into its tab first.
  if (tab) {
    await page.click(`#settingsPage [data-settings-tab="${tab}"]`);
    await page.waitForTimeout(100);
  }
}

test.describe("Settings page repair", () => {
  test("Daisy's checkbox labels sit beside their controls, not stacked and centered", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await openSettings(page, { tab: "florisyn" });

    const hideDaisyLabel = page.locator("#daisySettingsPanel label.check", { hasText: "Hide Daisy" });
    await expect(hideDaisyLabel).toBeVisible();
    const style = await hideDaisyLabel.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { display: cs.display, flexDirection: cs.flexDirection };
    });
    expect(style.display).toBe("flex");
    expect(style.flexDirection).toBe("row");

    // Labels must be clickable — activating the label toggles the checkbox.
    const checkbox = page.locator("#daisyHide");
    const before = await checkbox.isChecked();
    await hideDaisyLabel.click();
    expect(await checkbox.isChecked()).toBe(!before);
  });

  test("the AI status card is collapsed to a friendly summary by default, with full diagnostics behind Advanced", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await openSettings(page, { tab: "ai" });

    const details = page.locator("#settingsForm .ai-advanced");
    await expect(details).toBeAttached();
    expect(await details.evaluate((el) => el.open)).toBe(false);

    // Every original control is still present and functional once opened —
    // nothing was removed, only progressively disclosed.
    await details.locator("summary").click();
    expect(await details.evaluate((el) => el.open)).toBe(true);
    await expect(page.locator("#aiModelSelect")).toBeVisible();
    await expect(page.locator("#refreshAiStatus")).toBeVisible();
    await expect(page.locator("#installAiModel")).toBeVisible();
    await expect(page.locator("#testLocalAi")).toBeVisible();
  });

  test("assistant voice panels (Lily, Rose, Bud) are collapsed by default and expand to their full controls", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await openSettings(page, { tab: "ai" });

    for (const persona of ["lily", "rose", "bud"]) {
      const panel = page.locator(`#${persona}VoicePanel`);
      await expect(panel).toBeAttached();
      expect(await panel.evaluate((el) => el.open)).toBe(false);
      await panel.locator("summary").click();
      expect(await panel.evaluate((el) => el.open)).toBe(true);
      await expect(panel.locator(".assistant-voice-select")).toBeVisible();
      await expect(panel.locator(".assistant-voice-preview")).toBeVisible();
      await expect(panel.locator(".assistant-voice-restore")).toBeVisible();
    }

    // Daisy has no voice-tuning panel (she only plays an uploaded sample) —
    // confirm that wasn't accidentally added rather than left alone.
    await expect(page.locator("#daisyVoicePanel")).toHaveCount(0);
  });

  test("no florist-facing settings copy references internal admin concepts", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await openSettings(page);

    const bodyText = await page.locator("#settingsPage").innerText();
    expect(bodyText).not.toMatch(/managed in admin/i);
    expect(bodyText).not.toMatch(/UI Design Mode/i);
  });

  test("the settings grid does not force a short card to stretch to its taller neighbor's height", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await openSettings(page);

    const alignItems = await page.locator("#settingsForm.settings-grid").evaluate((el) => getComputedStyle(el).alignItems);
    expect(alignItems).toBe("start");
  });

  test("billing only shows subscription actions the current plan state actually allows", async ({ page }) => {
    await mockBackend(page);
    await page.route("**/.netlify/functions/shop-billing", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          can_manage: true,
          center: {
            current_plan: { label: "Pro", price_display: "$79/mo" },
            next_billing: "2026-09-01",
            status: "Active — pending cancellation",
            cancel_at_period_end: true,
            can_reactivate: true,
            can_resume: false,
            paused: false,
            upgrade_plan: null,
            downgrade_plan: null,
            history: {},
          },
        }),
      }),
    );
    await withFakeSession(page);
    await openSettings(page, { tab: "billing" });

    const actions = page.locator("#shopBillingRoot .sub-actions");
    await expect(actions).toBeVisible();
    // Reactivate is the one live path out of a pending cancellation —
    // Cancel/Pause/Resume must not also show, since none of them are
    // real options from this state.
    await expect(actions.locator("#subReactivate")).toBeVisible();
    await expect(actions.locator("#subCancel")).toHaveCount(0);
    await expect(actions.locator("#subPause")).toHaveCount(0);
    await expect(actions.locator("#subResume")).toHaveCount(0);
    await expect(actions.locator("#subExport")).toBeVisible();
  });

  test("billing shows Pause and Cancel (not Resume/Reactivate) for a normal active subscription", async ({ page }) => {
    await mockBackend(page);
    await page.route("**/.netlify/functions/shop-billing", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          can_manage: true,
          center: {
            current_plan: { label: "Pro", price_display: "$79/mo" },
            next_billing: "2026-09-01",
            status: "Active",
            cancel_at_period_end: false,
            can_reactivate: false,
            can_resume: false,
            paused: false,
            upgrade_plan: { code: "premium" },
            downgrade_plan: null,
            history: {},
          },
        }),
      }),
    );
    await withFakeSession(page);
    await openSettings(page, { tab: "billing" });

    const actions = page.locator("#shopBillingRoot .sub-actions");
    await expect(actions.locator("#subUpgrade")).toBeVisible();
    await expect(actions.locator("#subPause")).toBeVisible();
    await expect(actions.locator("#subCancel")).toBeVisible();
    await expect(actions.locator("#subResume")).toHaveCount(0);
    await expect(actions.locator("#subReactivate")).toHaveCount(0);
    await expect(actions.locator("#subDowngrade")).toHaveCount(0);
  });

  test("the referral hub renders inside a real card even when the program isn't configured yet", async ({ page }) => {
    await mockBackend(page);
    await page.route("**/.netlify/functions/referral-program", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );
    await withFakeSession(page);
    await openSettings(page, { tab: "florisyn" });

    const card = page.locator("#referralHubRoot .panel.referral-hub");
    await expect(card).toBeVisible();
    await expect(card).toContainText(/isn't set up for this shop yet/i);
  });

  test("Settings collapses to one column on tablet-and-narrower widths", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await page.setViewportSize({ width: 800, height: 900 });
    await openSettings(page);

    const columns = await page.locator("#settingsForm.settings-grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(1);
  });
});

test.describe("Assistant panel repair", () => {
  test("all four assistants (Lily, Rose, Daisy, Bud) are present and switchable", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await page.goto("/");
    await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
    await page.click("#lilyFab");

    for (const persona of ["Lily", "Rose", "Daisy", "Bud"]) {
      await expect(page.locator(`#lilyPersonas [data-lily-persona="${persona.toLowerCase()}"]`)).toBeVisible();
    }
    await page.click('#lilyPersonas [data-lily-persona="bud"]');
    await expect(page.locator("#lilyHeadName")).toHaveText("Bud");
  });

  test("preserves Chat, Recent, and Coach tabs and the quick-action toolbar", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await page.goto("/");
    await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
    await page.click("#lilyFab");

    await expect(page.locator('[data-lily-tab="chat"]')).toBeVisible();
    await expect(page.locator('[data-lily-tab="history"]')).toHaveText("Recent");
    await expect(page.locator('[data-lily-tab="coach"]')).toHaveText("Coach");
    await expect(page.locator("#lilyToolbar button")).toHaveCount(10);
  });

  test("an empty conversation does not force the panel to its full max-height", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await page.goto("/");
    await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
    await page.click("#lilyFab");

    const body = page.locator("#lilyBody");
    await expect(body).toBeEmpty();
    const minHeight = await body.evaluate((el) => getComputedStyle(el).minHeight);
    expect(minHeight).toBe("64px");
  });

  test("the conversation area scrolls internally instead of the panel overrunning the page", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await page.goto("/");
    await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
    await page.click("#lilyFab");

    const overflow = await page.locator("#lilyBody").evaluate((el) => getComputedStyle(el).overflow);
    expect(overflow).toBe("auto");
  });

  for (const [name, viewport] of Object.entries({
    desktop: { width: 1440, height: 900 },
    "narrow-desktop": { width: 1024, height: 800 },
    tablet: { width: 820, height: 1100 },
    mobile: { width: 390, height: 844 },
  })) {
    test(`the panel never exceeds a sensible max-width/max-height at ${name} width`, async ({ page }) => {
      await mockBackend(page);
      await withFakeSession(page);
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
      await page.click("#lilyFab");

      const box = await page.locator("#lilyPanel").boundingBox();
      expect(box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.height).toBeLessThanOrEqual(viewport.height);
      // Never a full-page takeover — always leaves real margin around it so
      // the working page underneath stays visible.
      expect(box.width).toBeLessThanOrEqual(viewport.width - 16);
    });
  }

  test("mobile: the panel head row does not wrap its close/expand/theme buttons onto the persona nav below it", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
    await page.click("#lilyFab");

    const head = page.locator("#lilyPanel .lily-panel-head");
    const flexWrap = await head.evaluate((el) => getComputedStyle(el).flexWrap);
    expect(flexWrap).toBe("nowrap");

    const headBox = await head.boundingBox();
    const personasBox = await page.locator("#lilyPersonas").boundingBox();
    // The persona row must start at or after the head row ends — no
    // vertical overlap between the two. A couple of sub-pixel tolerance
    // for layout rounding, not a real gap either box could hide behind.
    expect(personasBox.y).toBeGreaterThanOrEqual(headBox.y + headBox.height - 2);
  });

  test("Expand has a real, bounded effect at desktop width instead of no visible effect at all", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
    await page.click("#lilyFab");

    const before = await page.locator("#lilyPanel").boundingBox();
    await page.click("#lilyExpand");
    const after = await page.locator("#lilyPanel").boundingBox();
    expect(after.width).toBeGreaterThan(before.width);
    // Bounded, not a page takeover.
    expect(after.width).toBeLessThanOrEqual(1440 - 48);
    expect(after.height).toBeLessThanOrEqual(900 * 0.86 + 1);
  });
});
