import type { FillContext } from "../fieldResolver.js";
import { fillField } from "../fieldResolver.js";
import {
  clickNext,
  dismissCookieBanners,
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
    const applicantTypePatterns: RegExp[] = [
      /Private Individual/i,
      /Private/i,
      /Individual/i,
    ];
    let clicked = false;
    for (const re of applicantTypePatterns) {
      const label = form.locator("label").filter({ hasText: re }).first();
      try {
        await label.waitFor({ state: "visible", timeout: 8000 });
        await label.scrollIntoViewIfNeeded().catch(() => undefined);
        await label.click({ timeout: 8000 });
        clicked = true;
        break;
      } catch {
        // Try next pattern
      }
    }
    if (!clicked) {
      const radio = form
        .getByRole("radio", { name: /Private Individual|Private|Individual/i })
        .first();
      try {
        await radio.waitFor({ state: "visible", timeout: 8000 });
        await radio.scrollIntoViewIfNeeded().catch(() => undefined);
        await radio.click({ timeout: 8000 });
        clicked = true;
      } catch {
        // ignore
      }
    }
    if (!clicked) {
      const anyRadios = form.getByRole("radio").filter({ visible: true });
      if ((await anyRadios.count()) > 0) {
        await anyRadios.first().scrollIntoViewIfNeeded().catch(() => undefined);
        await anyRadios.first().click({ timeout: 8000 });
        clicked = true;
      }
    }
    if (!clicked) {
      throw new Error(
        "Seriti finance form did not open (applicant type visible but not clickable). Not a sheet cell. Clear Status, run load-only."
      );
    }

    if (!config.dryRun) {
      await clickNext(form, config);
    }
  }

  if (start === "email" || !config.dryRun) {
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
