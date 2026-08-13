import type { FillContext } from "../fieldResolver.js";
import { fillField } from "../fieldResolver.js";
import { clickNext, screenshotSection, waitForHeading } from "../formUtils.js";

const SECTION = "section2";

export async function runSection2(ctx: FillContext): Promise<void> {
  const { page, form, config } = ctx;

  await waitForHeading(form, /item information/i);
  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "before");

  await fillField(ctx, {
    name: "Know which vehicle you want",
    section: SECTION,
    labels: ["Know which vehicle", "vehicle you want", "Do you know which vehicle"],
    type: "select",
    names: ["carChoiceInd"],
    ids: ["ddlcarChoiceInd"],
  }, "No");

  await fillField(ctx, {
    name: "Max price range",
    section: SECTION,
    labels: ["Max price", "Maximum price", "price range"],
    synonyms: ["Max price range"],
    role: "textbox",
    type: "text",
    names: ["VehicleMaxPriceRange"],
    ids: ["txtVehicleMaxPriceRange"],
  }, "300 000");

  await fillField(ctx, {
    name: "Payment day",
    section: SECTION,
    labels: ["Payment day", "Preferred payment day"],
    type: "select",
    names: ["PaymentDay"],
    ids: ["ddlPaymentDay"],
  }, "25");

  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "after");

  if (!config.dryRun) {
    await clickNext(form, config);
  }
}
