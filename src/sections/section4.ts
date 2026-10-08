import type { FillContext } from "../fieldResolver.js";
import { fillField } from "../fieldResolver.js";
import { clickNextAndWait, screenshotSection, syncAddressFromPostal, waitForSelectorVisible, waitForSelectOptions } from "../formUtils.js";

const SECTION = "section4";

export async function runSection4(ctx: FillContext): Promise<void> {
  const { page, form, config } = ctx;
  const data = ctx.applicant;

  await waitForSelectorVisible(form, '[id="txtemployerName"], [id="ddlIndustry"]');
  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "before", config);

  await fillField(ctx, {
    name: "Industry",
    section: SECTION,
    labels: ["Industry"],
    role: "combobox",
    type: "select",
    names: ["industry"],
    ids: ["ddlIndustry"],
  }, data.industry);

  await waitForSelectOptions(form.locator('[id="ddlOccupation"]'));
  await fillField(ctx, {
    name: "Occupation",
    section: SECTION,
    labels: ["Occupation", "Job title"],
    role: "combobox",
    type: "select",
    names: ["occupation"],
    ids: ["ddlOccupation"],
  }, data.occupation);

  await waitForSelectOptions(form.locator('[id="ddlLevel"]'));
  await fillField(ctx, {
    name: "Level",
    section: SECTION,
    labels: ["Level", "Skill level", "Worker level"],
    role: "combobox",
    type: "select",
    names: ["level"],
    ids: ["ddlLevel"],
  }, data.employeeLevel);

  await fillField(ctx, {
    name: "Employer name",
    section: SECTION,
    labels: ["Employer name", "Employer", "Company name"],
    role: "textbox",
    type: "text",
    names: ["empEmployerName"],
    ids: ["txtemployerName"],
  }, data.employerName);

  await fillField(ctx, {
    name: "Telephone number",
    section: SECTION,
    labels: ["Telephone number", "Work telephone", "Employer phone", "Work phone"],
    role: "textbox",
    type: "text",
    names: ["workTelephoneNumber"],
    ids: ["txtempTelephoneNumber"],
  }, data.employerPhone);

  await fillField(ctx, {
    name: "Work province",
    section: SECTION,
    labels: ["Province"],
    role: "combobox",
    type: "select",
    names: ["clientEmpAddressProvince"],
    ids: ["clientEmpAddressDdlClientProvince"],
  }, data.employerProvince || data.province);

  // Prefer employer postal; else personal postal / address as Seriti place-search needles.
  const workPostalNeedle = data.employerPostalCode || data.postalCode;
  const workPostalHint = [data.employerAddress, data.addressLine1].filter(Boolean).join(" ");
  await fillField(ctx, {
    name: "Work postal code",
    section: SECTION,
    labels: ["Postal code", "Work postal code", "Employer postal code"],
    role: "textbox",
    type: "postal",
    postalHint: workPostalHint,
    postalProvince: data.employerProvince || data.province,
    names: ["clientEmpAddress"],
    ids: ["clientEmpAddress_value"],
  }, workPostalNeedle);

  const workAddressLine = await syncAddressFromPostal(
    form,
    "clientEmpAddress_value",
    data.employerAddress || data.addressLine1
  );
  await fillField(ctx, {
    name: "Work address line 1",
    section: SECTION,
    labels: ["Address line 1", "Work address", "Employer address"],
    role: "textbox",
    type: "text",
    names: ["clientEmpAddressAddressLine1"],
    ids: ["clientEmpAddressTxtClientAddressLine1"],
  }, workAddressLine);

  await waitForSelectorVisible(form, 'input[id*="empAddressStartDate"]');
  await fillField(ctx, {
    name: "Employment start date",
    section: SECTION,
    labels: [
      "When did you start working here",
      "Employment start date",
      "Employed since",
      "Start date",
      "Date started employment",
    ],
    role: "textbox",
    type: "date",
    names: ["employerStartDate"],
    ids: ["empAddressStartDate"],
  }, data.employmentStartDate);

  await fillField(ctx, {
    name: "Salary day",
    section: SECTION,
    labels: ["Salary day", "Pay day", "Payment day"],
    type: "select",
    names: ["salaryDay"],
    ids: ["ddlSalaryDay"],
  }, "25", { fallbackToFirst: true });

  await fillField(ctx, {
    name: "Gross monthly",
    section: SECTION,
    labels: ["Gross monthly", "Gross salary", "Gross income", "Basic salary"],
    role: "textbox",
    type: "text",
    names: ["basicSalary"],
    ids: ["txtBasicSalary"],
  }, data.grossMonthly);

  await fillField(ctx, {
    name: "Nett salary",
    section: SECTION,
    labels: ["Nett salary", "Net salary", "Net income", "Take home"],
    role: "textbox",
    type: "text",
    names: ["nettSalary"],
    ids: ["txtNettSalary"],
  }, data.nettSalary);

  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "after", config);

  if (!config.dryRun) {
    await clickNextAndWait(
      form,
      config,
      '[id="txtTelephonePayment"], [id="ddlBank"]',
      "Work & Salary"
    );
  }
}
