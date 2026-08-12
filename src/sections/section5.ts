import type { FillContext } from "../fieldResolver.js";
import { fillField } from "../fieldResolver.js";
import { screenshotSection } from "../formUtils.js";

const SECTION = "section5";

export async function runSection5(ctx: FillContext): Promise<void> {
  const { page, form } = ctx;
  const data = ctx.applicant;

  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "before");

  await fillField(ctx, {
    name: "Telephone payment",
    section: SECTION,
    labels: ["Telephone payment", "Telephone", "Phone payment"],
    role: "textbox",
    type: "text",
    names: ["telephonePayments"],
    ids: ["txtTelephonePayment"],
  }, data.telephoneExpense);

  await fillField(ctx, {
    name: "Transport costs",
    section: SECTION,
    labels: ["Transport costs", "Transport", "Travel costs"],
    role: "textbox",
    type: "text",
    names: ["transportCosts"],
    ids: ["txtTransportCosts"],
  }, data.transportExpense);

  await fillField(ctx, {
    name: "Food/entertainment",
    section: SECTION,
    labels: ["Food/entertainment", "Food and entertainment", "Food entertainment"],
    synonyms: ["Food", "Entertainment"],
    role: "textbox",
    type: "text",
    names: ["foodEntertainmentCosts"],
    ids: ["txtFoodEntertainmentCosts"],
  }, data.foodExpense);

  await fillField(ctx, {
    name: "Bank",
    section: SECTION,
    labels: ["Bank"],
    role: "combobox",
    type: "select",
    names: ["clientBank"],
    ids: ["ddlBank"],
  }, "Capitec");

  await fillField(ctx, {
    name: "Account type",
    section: SECTION,
    labels: ["Account type"],
    role: "combobox",
    type: "select",
    names: ["clientBankAccountType"],
    ids: ["clientBankDdlAccountType"],
  }, "Savings");

  await fillField(ctx, {
    name: "Account holder",
    section: SECTION,
    labels: ["Account holder", "Account holder name"],
    role: "textbox",
    type: "text",
    names: ["clientBankAccountHolderName"],
    ids: ["clientBankTxtAccountHolderName"],
  }, data.accountHolder);

  const zeroFilled = await fillField(ctx, {
    name: "Unnamed zero field",
    section: SECTION,
    labels: ["Account number", "Other payments"],
    role: "textbox",
    type: "text",
    names: ["clientBankAccountNumber"],
    ids: ["clientBankTxtAccountNumber"],
  }, "0");
  if (!zeroFilled) {
    console.warn("  [section5] Account number zero field not found — may not be present on this form version");
  }

  await fillField(ctx, {
    name: "Account holder different",
    section: SECTION,
    labels: ["Account holder different", "Is the account holder different", "Different account holder", "Payee entity"],
    type: "select",
    names: ["clientBanklblPayeeEntityNumberIndicator"],
    ids: ["clientBanklblPayeeEntityNumberIndicator"],
  }, "No");

  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "after");
}
