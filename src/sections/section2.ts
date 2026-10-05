import type { FillContext } from "../fieldResolver.js";
import { fillField } from "../fieldResolver.js";
import { clickNextAndWait, screenshotSection, waitForSelectorVisible } from "../formUtils.js";

const SECTION = "section2";

export async function runSection2(ctx: FillContext): Promise<void> {
  const { page, form, config } = ctx;
  const data = ctx.applicant;

  await waitForSelectorVisible(form, '[id="ddlcarChoiceInd"], [id="txtVehicleMaxPriceRange"]');
  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "before", config);

  await fillField(ctx, {
    name: "Know which vehicle you want",
    section: SECTION,
    labels: ["Know which vehicle", "vehicle you want", "Do you know which vehicle"],
    type: "select",
    names: ["carChoiceInd"],
    ids: ["ddlcarChoiceInd"],
  }, "No", { fallbackToFirst: true });

  await fillField(ctx, {
    name: "Max price range",
    section: SECTION,
    labels: ["Max price", "Maximum price", "price range"],
    synonyms: ["Max price range"],
    role: "textbox",
    type: "text",
    names: ["VehicleMaxPriceRange"],
    ids: ["txtVehicleMaxPriceRange"],
  }, data.maxPrice);

  await fillField(ctx, {
    name: "Payment day",
    section: SECTION,
    labels: ["Payment day", "Preferred payment day"],
    type: "select",
    names: ["PaymentDay"],
    ids: ["ddlPaymentDay"],
  }, "25", { fallbackToFirst: true });

  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "after", config);

  if (!config.dryRun) {
    await clickNextAndWait(
      form,
      config,
      '[id="txtClientFirstName"]',
      "Deal Information"
    );
  }
}
