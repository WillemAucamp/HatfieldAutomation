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

  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "before", config);

  // Sub-step 1: Applicant type (radio-style label click)
  await form.locator("label").filter({ hasText: /Private Individual/i }).first().click();

  if (!config.dryRun) {
    await clickNext(form, config);
    await waitForSelectorVisible(form, '[id="txtEmailAddress"]');
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
