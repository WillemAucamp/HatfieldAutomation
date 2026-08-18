import type { FillContext } from "../fieldResolver.js";
import { fillField } from "../fieldResolver.js";
import { clickNext, screenshotSection, waitForSelectorVisible } from "../formUtils.js";

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
  }, "Business services");

  await fillField(ctx, {
    name: "Occupation",
    section: SECTION,
    labels: ["Occupation", "Job title"],
    role: "combobox",
    type: "select",
    names: ["occupation"],
    ids: ["ddlOccupation"],
  }, "Labourer (Skilled)");

  await fillField(ctx, {
    name: "Level",
    section: SECTION,
    labels: ["Level", "Skill level", "Worker level"],
    role: "combobox",
    type: "select",
    names: ["level"],
    ids: ["ddlLevel"],
  }, "Skilled worker");

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
    name: "Work address line 1",
    section: SECTION,
    labels: ["Address line 1", "Work address", "Employer address"],
    role: "textbox",
    type: "text",
    names: ["clientEmpAddressAddressLine1"],
    ids: ["clientEmpAddressTxtClientAddressLine1"],
  }, data.employerAddress);

  await fillField(ctx, {
    name: "Work province",
    section: SECTION,
    labels: ["Province"],
    role: "combobox",
    type: "select",
    names: ["clientEmpAddressProvince"],
    ids: ["clientEmpAddressDdlClientProvince"],
  }, data.employerProvince || data.province || "Gauteng");

  await fillField(ctx, {
    name: "Work postal code",
    section: SECTION,
    labels: ["Postal code", "Work postal code", "Employer postal code"],
    role: "textbox",
    type: "postal",
    postalHint: data.employerAddress,
    postalProvince: data.employerProvince || data.province,
    names: ["clientEmpAddress"],
    ids: ["clientEmpAddress_value"],
  }, data.employerPostalCode);

  await fillField(ctx, {
    name: "Employment start date",
    section: SECTION,
    labels: ["Employment start date", "Employed since", "Start date", "Date started employment"],
    role: "textbox",
    type: "text",
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
  }, "25");

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
    await clickNext(form, config);
  }
}
