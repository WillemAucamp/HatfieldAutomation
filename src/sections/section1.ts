import type { FillContext } from "../fieldResolver.js";
import { fillField } from "../fieldResolver.js";
import {
  clickNext,
  fillRadioGroupsByAnswer,
  fillSelectByVisibleText,
  screenshotSection,
  waitForSelectorVisible,
} from "../formUtils.js";

const SECTION = "section1";

export async function runSection1(ctx: FillContext): Promise<void> {
  const { page, form, config } = ctx;
  const data = ctx.applicant;

  // Cookie banners can cover/obscure the first step controls.
  await page
    .getByRole("button", { name: /got it|accept|accept cookies/i })
    .first()
    .click({ timeout: 5000 })
    .catch(() => undefined);

  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "before", config);

  const emailAlreadyVisible = await form
    .locator('[id="txtEmailAddress"]')
    .first()
    .isVisible()
    .catch(() => false);

  if (!emailAlreadyVisible) {
    // Sub-step 1: Applicant type (radio-style label click)
    const applicantTypePatterns: RegExp[] = [
      /Private Individual/i,
      /Private/i,
      /Individual/i,
    ];
    let clicked = false;
    for (const re of applicantTypePatterns) {
      const label = form.locator("label").filter({ hasText: re }).first();
      try {
        // The applicant-type control can appear slightly late depending on network timing.
        await label.waitFor({ state: "visible", timeout: 15000 });
        await label.scrollIntoViewIfNeeded().catch(() => undefined);
        await label.click({ timeout: 15000 });
        clicked = true;
        break;
      } catch {
        // Try next pattern
      }
    }
    if (!clicked) {
      // As a fallback, try clicking a radio by accessible name.
      const radio = form
        .getByRole("radio", { name: /Private Individual|Private|Individual/i })
        .first();
      try {
        await radio.waitFor({ state: "visible", timeout: 15000 });
        await radio.scrollIntoViewIfNeeded().catch(() => undefined);
        await radio.click({ timeout: 15000 });
        clicked = true;
      } catch {
        // ignore
      }
    }
    if (!clicked) {
      throw new Error('Applicant type selector not found (expected "Private Individual").');
    }

    if (!config.dryRun) {
      await clickNext(form, config);
      await waitForSelectorVisible(form, '[id="txtEmailAddress"]');
    }
  }

  await screenshotSection(page, form, ctx.screenshotDir, `${SECTION}-step2`, "before", config);

  // Sub-step 2: Email, declarations, consents, salesperson
  await fillField(ctx, {
    name: "Email",
    section: SECTION,
    labels: ["Email", "E-mail", "email address"],
    role: "textbox",
    type: "text",
    names: ["emailAddress"],
    ids: ["txtEmailAddress"],
  }, data.email);

  // 7 declaration questions → No
  await fillRadioGroupsByAnswer(form, config, 7, "No", 0);

  // Remaining consent questions → Yes (typically 2+ groups after declarations)
  const consentGroupCount = 2;
  await fillRadioGroupsByAnswer(form, config, consentGroupCount, "Yes", 7);

  await fillSelectByVisibleText(form, config, "#branchSalesPerson", "Willem Leendert Kuperus");

  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "after", config);

  if (!config.dryRun) {
    await clickNext(form, config);
  }
}
