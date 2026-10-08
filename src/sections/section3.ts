import type { FillContext } from "../fieldResolver.js";
import { fillField } from "../fieldResolver.js";
import { clickNextAndWait, screenshotSection, syncAddressFromPostal, waitForSelectorVisible } from "../formUtils.js";

const SECTION = "section3";

export async function runSection3(ctx: FillContext): Promise<void> {
  const { page, form, config } = ctx;
  const data = ctx.applicant;

  await waitForSelectorVisible(form, '[id="txtClientFirstName"]');
  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "before", config);

  await fillField(ctx, {
    name: "Title",
    section: SECTION,
    labels: ["Title"],
    role: "combobox",
    type: "select",
    names: ["clientTitle"],
    ids: ["ddlClientTitle"],
  }, data.title);

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

  async function fillInitials(): Promise<void> {
    if (!data.initials) return;
    await fillField(ctx, {
      name: "Initials",
      section: SECTION,
      labels: ["Initials", "Initial"],
      role: "textbox",
      type: "text",
      names: ["clientInitials"],
      ids: ["txtClientInitials", "txtInitials"],
    }, data.initials);
  }

  await fillInitials();

  // Name entry recreates identity controls with a new numeric prefix (71_IdType → 72_IdType).
  await waitForSelectorVisible(form, '[id$="_IdType"], [id$="_IdNumber"]');

  await fillField(ctx, {
    name: "ID type",
    section: SECTION,
    labels: ["ID type", "Identity type", "Identification type"],
    role: "combobox",
    type: "select",
    names: ["_IdType", "IdType"],
    ids: ["_IdType", "IdType"],
  }, "RSA", { fallbackToFirst: true });

  await fillField(ctx, {
    name: "ID number",
    section: SECTION,
    labels: ["ID number", "Identity number", "Identification number"],
    role: "textbox",
    type: "text",
    names: ["_IdNumber", "IdNumber"],
    ids: ["_IdNumber", "IdNumber"],
  }, data.idNumber);

  // Seriti often blanks Initials when identity controls recreate — fill again.
  await fillInitials();

  await fillField(ctx, {
    name: "Educational level",
    section: SECTION,
    labels: ["Educational level", "Education level", "Education"],
    role: "combobox",
    type: "select",
    names: ["clientEducationLevel"],
    ids: ["ddlClientEducationLevel"],
  }, data.educationalLevel);

  await fillField(ctx, {
    name: "Citizenship country",
    section: SECTION,
    labels: ["Country of Citizenship", "Citizenship", "Nationality"],
    role: "combobox",
    type: "select",
    names: ["clientCitizenshipCountryId"],
    ids: ["ddlClientCitizenshipCountryId"],
  }, "South Africa", { fallbackToFirst: true });

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
  }, "No", { fallbackToFirst: true });

  await fillField(ctx, {
    name: "Province",
    section: SECTION,
    labels: ["Province"],
    role: "combobox",
    type: "select",
    names: ["clientPhysicalAddressProvince"],
    ids: ["clientPhysicalAddressDdlClientProvince"],
  }, data.province);

  await fillField(ctx, {
    name: "Postal code",
    section: SECTION,
    labels: ["Postal code", "Post code", "Zip code"],
    role: "textbox",
    type: "postal",
    postalHint: data.addressLine1,
    postalProvince: data.province,
    names: ["clientPhysicalAddress"],
    ids: ["clientPhysicalAddress_value"],
  }, data.postalCode);

  const addressLine = await syncAddressFromPostal(form, "clientPhysicalAddress_value", data.addressLine1);
  // #region agent log
  {
    const postalVal = await form
      .locator('[id$="clientPhysicalAddress_value"]')
      .filter({ visible: true })
      .first()
      .inputValue()
      .catch(() => "");
    const fs = await import("node:fs");
    fs.appendFileSync(
      "/opt/cursor/logs/debug.log",
      JSON.stringify({
        hypothesisId: "C",
        location: "section3.ts:address-sync",
        message: "Address after postal sync",
        data: {
          sheetAddress: data.addressLine1,
          postalVal,
          addressLineUsed: addressLine,
        },
        timestamp: Date.now(),
      }) + "\n"
    );
  }
  // #endregion
  await fillField(ctx, {
    name: "Address line 1",
    section: SECTION,
    labels: ["Address line 1", "Address", "Street address", "Residential address"],
    role: "textbox",
    type: "text",
    names: ["clientPhysicalAddressAddressLine1"],
    ids: ["clientPhysicalAddressTxtClientAddressLine1"],
  }, addressLine);

  await waitForSelectorVisible(form, '[id*="txtClientPhysicalAddressDate"]');
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
    type: "date",
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
  }, data.maritalStatus);

  // #region agent log
  {
    const maritalOpts = await form
      .locator('[id*="MaritalStatus"], [id*="maritalStatus"]')
      .first()
      .evaluate((el) =>
        Array.from((el as HTMLSelectElement).options || []).map((o) => ({
          v: o.value,
          t: o.text,
          sel: o.selected,
        }))
      )
      .catch(() => []);
    const fs = await import("node:fs");
    fs.appendFileSync(
      "/opt/cursor/logs/debug.log",
      JSON.stringify({
        hypothesisId: "F",
        location: "section3.ts:after-marital",
        message: "Marital status options after select",
        data: { sheetMarital: data.maritalStatus, maritalOpts },
        timestamp: Date.now(),
      }) + "\n"
    );
  }
  // #endregion

  // Married expands required Spouse fields; fill before next-of-kin (form re-renders).
  if (/married/i.test(data.maritalStatus || "")) {
    const spouse = String(data.spouseFullName || "").trim();
    const spouseParts = spouse.split(/\s+/).filter(Boolean);
    const spouseFirst = spouseParts.slice(0, -1).join(" ") || spouseParts[0] || "";
    const spouseLast = spouseParts.length > 1 ? spouseParts[spouseParts.length - 1]! : "";
    if (spouseFirst) {
      await fillField(ctx, {
        name: "Spouse first name",
        section: SECTION,
        labels: ["Spouse first name", "Spouse name", "Partner first name"],
        role: "textbox",
        type: "text",
        names: ["spouseFirstName", "clientSpouseFirstName"],
        ids: ["txtSpouseFirstName", "txtClientSpouseFirstName"],
      }, spouseFirst);
    }
    if (spouseLast) {
      await fillField(ctx, {
        name: "Spouse surname",
        section: SECTION,
        labels: ["Spouse surname", "Spouse last name", "Partner surname"],
        role: "textbox",
        type: "text",
        names: ["spouseLastName", "clientSpouseLastName"],
        ids: ["txtSpouseLastName", "txtClientSpouseLastName"],
      }, spouseLast);
    }
    if (data.spousePhone) {
      await fillField(ctx, {
        name: "Spouse mobile",
        section: SECTION,
        labels: ["Spouse mobile", "Spouse phone", "Partner mobile"],
        role: "textbox",
        type: "text",
        names: ["spouseMobileNumber", "clientSpouseMobileNumber"],
        ids: ["txtSpouseMobileNumber", "txtClientSpouseMobileNumber"],
      }, data.spousePhone);
    }
  }

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
  }, data.nextOfKinRelationship, { fallbackToFirst: true });

  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "after", config);

  // #region agent log
  {
    const dump = await form
      .evaluate(() => {
        const interesting: Array<Record<string, string | boolean | null>> = [];
        const nodes = Array.from(
          document.querySelectorAll("input, select, textarea, label")
        ) as HTMLElement[];
        for (const el of nodes) {
          const id = el.id || "";
          const name = (el as HTMLInputElement).name || "";
          const tag = el.tagName.toLowerCase();
          const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
          const hay = `${id} ${name} ${text}`.toLowerCase();
          if (
            !/spouse|marital|marriage|initial|address|postal|relative|kin/.test(hay)
          ) {
            continue;
          }
          const input = el as HTMLInputElement;
          interesting.push({
            tag,
            id,
            name,
            type: input.type || null,
            value: input.value ?? null,
            text: tag === "label" ? text : null,
            required: input.required === true,
            cls: (el.className || "").toString().slice(0, 120),
            visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
          });
        }
        const reds = Array.from(
          document.querySelectorAll(
            ".field-validation-error, .text-danger, .has-error, .input-validation-error, [aria-invalid='true']"
          )
        ).map((el) => ({
          tag: el.tagName,
          id: (el as HTMLElement).id || "",
          cls: ((el as HTMLElement).className || "").toString().slice(0, 100),
          text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100),
        }));
        const addr = {
          line1: (document.querySelector('[id*="AddressLine1"]') as HTMLInputElement | null)
            ?.value,
          postal: (document.querySelector('[id*="PhysicalAddress_value"], [id$="clientPhysicalAddress_value"]') as HTMLInputElement | null)
            ?.value,
        };
        return { interesting, reds, addr };
      })
      .catch((e) => ({ error: String(e) }));
    const fs = await import("node:fs");
    fs.appendFileSync(
      "/opt/cursor/logs/debug.log",
      JSON.stringify({
        hypothesisId: "A-E",
        location: "section3.ts:pre-next",
        message: "Personal form state before Next",
        data: {
          sheetAddress: data.addressLine1,
          sheetSpousePhone: data.spousePhone,
          initials: data.initials,
          dump,
        },
        timestamp: Date.now(),
      }) + "\n"
    );
  }
  // #endregion

  if (!config.dryRun) {
    try {
      await clickNextAndWait(
        form,
        config,
        '[id="txtemployerName"], [id="ddlIndustry"]',
        "Personal Information"
      );
      // #region agent log
      {
        const fs = await import("node:fs");
        fs.appendFileSync(
          "/opt/cursor/logs/debug.log",
          JSON.stringify({
            hypothesisId: "A",
            location: "section3.ts:post-next",
            message: "Personal Next succeeded",
            data: {},
            timestamp: Date.now(),
          }) + "\n"
        );
      }
      // #endregion
    } catch (err) {
      // #region agent log
      {
        const alerts = await form
          .evaluate(() => {
            const msgs = Array.from(
              document.querySelectorAll(
                ".field-validation-error, .text-danger, .alert-danger, .help-block, [role='alert']"
              )
            )
              .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
              .filter(Boolean)
              .slice(0, 12);
            const invalid = Array.from(
              document.querySelectorAll(
                "input.input-validation-error, select.input-validation-error, .has-error input, .has-error select, input[aria-invalid='true']"
              )
            ).map((el) => {
              const input = el as HTMLInputElement;
              return {
                id: input.id,
                name: input.name,
                value: input.value,
                cls: (input.className || "").toString().slice(0, 80),
              };
            });
            return { msgs, invalid };
          })
          .catch((e) => ({ error: String(e) }));
        const fs = await import("node:fs");
        fs.appendFileSync(
          "/opt/cursor/logs/debug.log",
          JSON.stringify({
            hypothesisId: "A-B",
            location: "section3.ts:next-failed",
            message: "Personal Next failed — validation dump",
            data: { err: err instanceof Error ? err.message : String(err), alerts },
            timestamp: Date.now(),
          }) + "\n"
        );
      }
      // #endregion
      throw err;
    }
  }
}
