import type { FillContext } from "../fieldResolver.js";
import { fillField } from "../fieldResolver.js";
import { clickNext, screenshotSection } from "../formUtils.js";

const SECTION = "section3";

export async function runSection3(ctx: FillContext): Promise<void> {
  const { page, form, config } = ctx;
  const data = ctx.applicant;

  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "before");

  await fillField(ctx, {
    name: "Title",
    section: SECTION,
    labels: ["Title"],
    role: "combobox",
    type: "select",
    names: ["clientTitle"],
    ids: ["ddlClientTitle"],
  }, "Mr");

  await fillField(ctx, {
    name: "First name",
    section: SECTION,
    labels: ["First name", "Given name"],
    synonyms: ["Name"],
    role: "textbox",
    type: "text",
    names: ["clientFirstName"],
    ids: ["txtClientFirstName"],
  }, data.firstName);

  await fillField(ctx, {
    name: "Surname",
    section: SECTION,
    labels: ["Surname", "Last name", "Family name"],
    role: "textbox",
    type: "text",
    names: ["clientLastName"],
    ids: ["txtClientLastName"],
  }, data.surname);

  await fillField(ctx, {
    name: "ID type",
    section: SECTION,
    labels: ["ID type", "Identity type", "Identification type"],
    role: "combobox",
    type: "select",
    names: ["71_IdType"],
    ids: ["71_IdType"],
  }, "RSA");

  await fillField(ctx, {
    name: "ID number",
    section: SECTION,
    labels: ["ID number", "Identity number", "Identification number"],
    role: "textbox",
    type: "text",
    names: ["71_IdNumber"],
    ids: ["71_IdNumber"],
  }, data.idNumber);

  await fillField(ctx, {
    name: "Educational level",
    section: SECTION,
    labels: ["Educational level", "Education level", "Education"],
    role: "combobox",
    type: "select",
    names: ["clientEducationLevel"],
    ids: ["ddlClientEducationLevel"],
  }, "Matric certificate");

  await fillField(ctx, {
    name: "Mobile number",
    section: SECTION,
    labels: ["Mobile number", "Mobile", "Cell number", "Cellphone"],
    role: "textbox",
    type: "text",
    names: ["clientMobileNumber"],
    ids: ["txtClientMobileNumber"],
  }, data.mobile);

  await fillField(ctx, {
    name: "Foreign birthplace",
    section: SECTION,
    labels: ["Foreign birthplace", "born outside", "foreign country", "foreign affiliation"],
    type: "select",
    names: ["foreignAffiliationInd"],
    ids: ["foreignAffiliationInd"],
  }, "No");

  await fillField(ctx, {
    name: "Address line 1",
    section: SECTION,
    labels: ["Address line 1", "Address", "Street address", "Residential address"],
    role: "textbox",
    type: "text",
    names: ["clientPhysicalAddressAddressLine1"],
    ids: ["clientPhysicalAddressTxtClientAddressLine1"],
  }, data.addressLine1);

  await fillField(ctx, {
    name: "Postal code",
    section: SECTION,
    labels: ["Postal code", "Post code", "Zip code"],
    role: "textbox",
    type: "postal",
    names: ["clientPhysicalAddress"],
    ids: ["clientPhysicalAddress_value"],
  }, data.postalCode);

  await fillField(ctx, {
    name: "Province",
    section: SECTION,
    labels: ["Province"],
    role: "combobox",
    type: "select",
    names: ["clientPhysicalAddressProvince"],
    ids: ["clientPhysicalAddressDdlClientProvince"],
  }, "Gauteng");

  await fillField(ctx, {
    name: "Date started living here",
    section: SECTION,
    labels: [
      "Date started living here",
      "Living here since",
      "Residency start",
      "When did you start living",
    ],
    role: "textbox",
    type: "text",
    names: ["clientPhysicalAddressDate"],
    ids: ["txtClientPhysicalAddressDate"],
  }, data.residencyStartDate);

  await fillField(ctx, {
    name: "Marital status",
    section: SECTION,
    labels: ["Marital status"],
    role: "combobox",
    type: "select",
    names: ["clientMaritalStatus"],
    ids: ["ddlClientMaritalStatus"],
  }, "Single");

  await fillField(ctx, {
    name: "Next of kin name",
    section: SECTION,
    labels: ["Next of kin name", "Next of kin first name", "Kin name"],
    role: "textbox",
    type: "text",
    names: ["relativeFirstName"],
    ids: ["txtRelativeFirstName"],
  }, data.nextOfKinName);

  await fillField(ctx, {
    name: "Next of kin surname",
    section: SECTION,
    labels: ["Next of kin surname", "Kin surname"],
    role: "textbox",
    type: "text",
    names: ["relativeLastName"],
    ids: ["txtRelativeLastName"],
  }, data.nextOfKinSurname);

  if (data.nextOfKinPhone) {
    await fillField(ctx, {
      name: "Next of kin mobile",
      section: SECTION,
      labels: ["Next of kin mobile", "Kin mobile", "Relative mobile"],
      role: "textbox",
      type: "text",
      names: ["relativeMobileNumber"],
      ids: ["txtRelativeMobileNumber"],
    }, data.nextOfKinPhone);
  }

  await fillField(ctx, {
    name: "Next of kin relationship",
    section: SECTION,
    labels: ["Next of kin relationship", "Relationship", "Kin relationship"],
    role: "combobox",
    type: "select",
    names: ["relativeRelation"],
    ids: ["ddlRelativeRelation"],
  }, "Siblings");

  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "after");

  if (!config.dryRun) {
    await clickNext(form, config);
  }
}
