import type { FillContext } from "../fieldResolver.js";
import { fillField } from "../fieldResolver.js";
import {
  clickNext,
  clickNextAndWait,
  dismissCookieBanners,
  domClick,
  fillRadioGroupsByAnswer,
  fillSelectByVisibleText,
  screenshotSection,
  waitForFinanceFormReady,
  waitForSelectorVisible,
} from "../formUtils.js";

const SECTION = "section1";

export async function runSection1(ctx: FillContext): Promise<void> {
  const { page, form, config } = ctx;
  const data = ctx.applicant;

  await dismissCookieBanners(page);

  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "before", config);

  const start = await waitForFinanceFormReady(form);

  if (start === "applicant-type") {
    const privateRadio = form.locator('input[type="radio"][value="PRIVATE"]').first();
    const alreadyPrivate = await privateRadio.isChecked().catch(() => false);
    if (!alreadyPrivate) {
      if ((await privateRadio.count().catch(() => 0)) > 0) {
        await domClick(privateRadio);
      } else {
        const label = form.getByText(/private individual/i).first();
        await label.waitFor({ state: "visible", timeout: 8000 });
        await domClick(label);
      }
    }

    if (!config.dryRun) {
      await clickNextAndWait(form, config, '[id="txtEmailAddress"]', "Applicant type");
    }
  } else if (!config.dryRun) {
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

  await fillSelectByVisibleText(form, config, "#branchSalesPerson", "Willem Leendert Kuperus", "Salesperson");

  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "after", config);

  if (!config.dryRun) {
    await clickNext(form, config);
  }
}
