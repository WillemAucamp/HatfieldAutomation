import Fuse from "fuse.js";
import type { Frame, Locator, Page } from "playwright";
import type { ApplicantRecord, AppConfig, FieldStrategy, FieldWarning } from "./types.js";
import { matchSelectOption, type FormScope } from "./formUtils.js";
import { formatDateForForm, postalSearchNeedles, restorePostalCode, valuesMatch } from "./transforms.js";
import { createWarning } from "./logger.js";
import { randomDelay } from "./utils.js";

export interface FieldTarget {
  name: string;
  section: string;
  /** Primary label / accessible name to match */
  labels: string[];
  synonyms?: string[];
  role?: "textbox" | "combobox" | "radio" | "checkbox" | "spinbutton";
  type?: "text" | "select" | "radio" | "checkbox" | "postal" | "date";
  /** Address line used to build richer postal autocomplete search terms. */
  postalHint?: string;
  /** Province hint for postal autocomplete (e.g. Gauteng → Pretoria). */
  postalProvince?: string;
  /** Optional stable name/id hints (used after label strategies) */
  names?: string[];
  ids?: string[];
}

export interface FillContext {
  page: Page;
  form: Frame;
  config: AppConfig;
  applicant: ApplicantRecord;
  screenshotDir: string;
  warnings: FieldWarning[];
}

function byId(form: FormScope, id: string): Locator {
  return form.locator(`[id="${id}"]`);
}

function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

function allLabels(target: FieldTarget): string[] {
  return [...target.labels, ...(target.synonyms ?? [])];
}

async function findByLabel(form: FormScope, target: FieldTarget): Promise<Locator | null> {
  for (const label of allLabels(target)) {
    const normalized = normalizeText(label);
    const labels = form.locator("label");
    const count = await labels.count();

    for (let i = 0; i < count; i++) {
      const labelEl = labels.nth(i);
      if (!(await labelEl.isVisible().catch(() => false))) continue;
      const text = normalizeText((await labelEl.textContent()) ?? "");
      if (text.includes(normalized) || normalized.includes(text)) {
        const forAttr = await labelEl.getAttribute("for");
        if (forAttr) {
          const input = form.locator(`[id="${forAttr}"]`);
          if ((await input.count()) > 0) return input.first();
        }
        const nested = labelEl.locator("input, select, textarea");
        if ((await nested.count()) > 0) return nested.first();
      }
    }
  }
  return null;
}

async function findByRole(form: FormScope, target: FieldTarget): Promise<Locator | null> {
  const role = target.role ?? "textbox";
  for (const label of allLabels(target)) {
    try {
      const locator = form.getByRole(role, { name: new RegExp(label, "i") }).first();
      if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
        return locator;
      }
    } catch {
      // continue
    }
  }
  return null;
}

async function findByPlaceholder(form: FormScope, target: FieldTarget): Promise<Locator | null> {
  for (const label of allLabels(target)) {
    const locator = form.locator(
      `input[placeholder*="${label}" i], textarea[placeholder*="${label}" i]`
    );
    if ((await locator.count()) > 0) return locator.first();
  }
  return null;
}

async function findByFieldset(form: FormScope, target: FieldTarget): Promise<Locator | null> {
  for (const label of allLabels(target)) {
    const normalized = normalizeText(label);
    const fieldsets = form.locator("fieldset, [role='group'], section, div.form-group");
    const count = await fieldsets.count();

    for (let i = 0; i < count; i++) {
      const group = fieldsets.nth(i);
      const legend = group.locator("legend, h1, h2, h3, h4, h5, h6, label").first();
      const legendText = normalizeText((await legend.textContent().catch(() => "")) ?? "");
      const groupText = normalizeText((await group.textContent()) ?? "").slice(0, 200);

      if (legendText.includes(normalized) || groupText.startsWith(normalized)) {
        const input = group.locator("input, select, textarea").first();
        if ((await input.count()) > 0) return input;
      }
    }
  }
  return null;
}

async function collectVisibleLabels(form: FormScope): Promise<{ text: string; locator: Locator }[]> {
  const results: { text: string; locator: Locator }[] = [];
  const labels = form.locator("label");
  const count = await labels.count();

  for (let i = 0; i < count; i++) {
    const labelEl = labels.nth(i);
    const text = (await labelEl.textContent())?.trim() ?? "";
    if (text && (await labelEl.isVisible().catch(() => false))) {
      results.push({ text, locator: labelEl });
    }
  }
  return results;
}

async function findByFuzzy(form: FormScope, target: FieldTarget): Promise<Locator | null> {
  const visible = await collectVisibleLabels(form);
  const fuse = new Fuse(
    visible.map((v) => v.text),
    { threshold: 0.4, includeScore: true }
  );

  for (const term of allLabels(target)) {
    const matches = fuse.search(term);
    if (matches.length > 0) {
      const matchText = matches[0].item;
      const match = visible.find((v) => v.text === matchText);
      if (match) {
        const forAttr = await match.locator.getAttribute("for");
        if (forAttr) {
          const input = form.locator(`[id="${forAttr}"]`);
          if ((await input.count()) > 0) return input.first();
        }
        const nested = match.locator.locator("input, select, textarea");
        if ((await nested.count()) > 0) return nested.first();
      }
    }
  }
  return null;
}

async function firstVisibleOrAny(locator: Locator): Promise<Locator | null> {
  if ((await locator.count()) === 0) return null;
  const visible = locator.filter({ visible: true });
  if ((await visible.count()) > 0) return visible.first();
  return locator.first();
}

async function findBySemanticHints(form: FormScope, target: FieldTarget): Promise<Locator | null> {
  for (const id of target.ids ?? []) {
    const exact = await firstVisibleOrAny(byId(form, id));
    if (exact) return exact;
    const bySuffix = await firstVisibleOrAny(form.locator(`[id$="${id}"]`));
    if (bySuffix) return bySuffix;
  }
  for (const name of target.names ?? []) {
    const byName = await firstVisibleOrAny(form.locator(`[name="${name}"]`));
    if (byName) return byName;
    const byNameSuffix = await firstVisibleOrAny(form.locator(`[name$="${name}"]`));
    if (byNameSuffix) return byNameSuffix;
  }
  return null;
}

export async function resolveField(
  form: FormScope,
  target: FieldTarget
): Promise<{ locator: Locator | null; strategy?: FieldStrategy }> {
  const hasSemantic = (target.ids?.length ?? 0) > 0 || (target.names?.length ?? 0) > 0;
  const strategies: { name: FieldStrategy; fn: () => Promise<Locator | null> }[] = [];

  // Stable name/id hints first when present — this form keeps every step in the DOM,
  // so walking all labels/roles on hidden steps is slow and noisy.
  if (hasSemantic) {
    strategies.push({ name: "semantic", fn: () => findBySemanticHints(form, target) });
    strategies.push({ name: "role", fn: () => findByRole(form, target) });
    strategies.push({ name: "label", fn: () => findByLabel(form, target) });
  } else {
    strategies.push(
      { name: "role", fn: () => findByRole(form, target) },
      { name: "label", fn: () => findByLabel(form, target) },
      { name: "placeholder", fn: () => findByPlaceholder(form, target) },
      { name: "fieldset", fn: () => findByFieldset(form, target) },
      { name: "fuzzy", fn: () => findByFuzzy(form, target) },
      { name: "semantic", fn: () => findBySemanticHints(form, target) }
    );
  }

  for (const { name, fn } of strategies) {
    const locator = await fn();
    if (locator && (await locator.count()) > 0) {
      console.log(`  [fieldResolver] "${target.name}" found via ${name}`);
      return { locator, strategy: name };
    }
  }

  console.warn(`  [fieldResolver] "${target.name}" NOT FOUND (all strategies failed)`);
  return { locator: null };
}

async function readFieldValue(locator: Locator): Promise<string> {
  const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
  const type = await locator.getAttribute("type");

  if (tag === "select") {
    return locator.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.text ?? "");
  }
  if (type === "radio" || type === "checkbox") {
    const checked = await locator.isChecked();
    return checked ? "checked" : "";
  }
  return locator.inputValue().catch(async () => (await locator.textContent()) ?? "");
}

async function verifyFill(
  locator: Locator,
  expected: string,
  fieldType: FieldTarget["type"]
): Promise<boolean> {
  const actual = await readFieldValue(locator);
  if (fieldType === "radio" || fieldType === "checkbox") {
    return actual === "checked";
  }
  if (fieldType === "date") {
    return valuesMatch(formatDateForForm(expected), actual) || valuesMatch(expected, actual);
  }
  return valuesMatch(expected, actual);
}

async function fillTextInput(locator: Locator, value: string, _config: AppConfig): Promise<void> {
  await locator.fill(value, { timeout: 10000 });
  await locator.evaluate((el, val) => {
    const input = el as HTMLInputElement;
    if (input.value !== val) input.value = val;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function selectDropdownByText(
  form: FormScope,
  locator: Locator,
  value: string,
  config: AppConfig
): Promise<void> {
  await locator.waitFor({ state: "visible", timeout: 15000 });
  const tag = await locator.evaluate((el) => el.tagName.toLowerCase());

  if (tag === "select") {
    const match = await matchSelectOption(locator, value);
    await locator.selectOption({ value: match.value });
    await locator.evaluate((el) => {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    console.log(`  [fieldResolver] Selected "${match.text}"`);
  } else {
    await locator.click();
    const option = form.getByRole("option", { name: new RegExp(`^${value}$`, "i") }).first();
    if (await option.isVisible({ timeout: 1500 }).catch(() => false)) {
      await option.click();
    } else {
      await form.getByText(new RegExp(`^${value}$`, "i")).first().click();
    }
  }
}

async function selectDropdownByIndex(
  locator: Locator,
  index: number,
  config: AppConfig
): Promise<string> {
  await locator.waitFor({ state: "visible", timeout: 15000 });
  const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
  if (tag === "select") {
    const text = await locator.evaluate((el, idx) => {
      const select = el as HTMLSelectElement;
      if (!select.options[idx]) return "";
      select.selectedIndex = idx;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      select.dispatchEvent(new Event("input", { bubbles: true }));
      return select.selectedOptions[0]?.text ?? "";
    }, index);
    console.log(`  [fieldResolver] Selected dropdown index ${index}: "${text}"`);
    await randomDelay(config);
    return text;
  }
  await locator.click();
  await randomDelay(config);
  const options = locator.page().getByRole("option");
  const option = options.nth(index);
  const text = (await option.textContent()) ?? "";
  await option.click();
  console.log(`  [fieldResolver] Selected dropdown index ${index}: "${text}"`);
  await randomDelay(config);
  return text;
}

async function selectRadioInGroup(
  form: FormScope,
  groupLabel: string,
  optionText: string,
  config: AppConfig
): Promise<void> {
  const groupPattern = new RegExp(groupLabel, "i");
  const optionPattern = new RegExp(`^${optionText}$`, "i");

  const byRole = form.getByRole("radio", { name: optionPattern });
  if ((await byRole.count()) > 0) {
    await byRole.first().check({ force: true });
    await randomDelay(config);
    return;
  }

  const labels = form.locator("label");
  const count = await labels.count();
  for (let i = 0; i < count; i++) {
    const label = labels.nth(i);
    const text = (await label.textContent()) ?? "";
    if (optionPattern.test(text.trim())) {
      const forAttr = await label.getAttribute("for");
      if (forAttr) {
        await form.locator(`[id="${forAttr}"]`).check({ force: true });
        await randomDelay(config);
        return;
      }
      await label.click();
      await randomDelay(config);
      return;
    }
  }

  const group = form.locator("fieldset, div").filter({ hasText: groupPattern });
  const radio = group.getByText(optionPattern).first();
  await radio.click();
  await randomDelay(config);
}

async function resolveDateLocator(
  form: FormScope,
  target: FieldTarget,
  fallback: Locator
): Promise<Locator> {
  const idHint = target.ids?.[0];
  if (idHint) {
    const inputById = form.locator(`input[id*="${idHint}"]`).filter({ visible: true });
    if ((await inputById.count()) > 0) return inputById.first();
    const anyById = form.locator(`[id*="${idHint}"]`).filter({ visible: true });
    if ((await anyById.count()) > 0) return anyById.first();
  }
  return fallback;
}

async function readDateValue(locator: Locator): Promise<string> {
  return (await locator.inputValue().catch(() => "")).trim();
}

async function fillDateInput(locator: Locator, value: string, config: AppConfig): Promise<void> {
  const formatted = formatDateForForm(value);
  await locator.waitFor({ state: "visible", timeout: 15000 });
  await locator.scrollIntoViewIfNeeded();

  const typeDate = async (): Promise<string> => {
    await locator.click({ timeout: 10000 });
    await locator.fill("");
    await locator.pressSequentially(formatted, { delay: 35 });
    await locator.evaluate((el) => {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    });
    await randomDelay(config);
    return readDateValue(locator);
  };

  let finalValue = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    finalValue = await typeDate();
    if (finalValue) break;
    await fillTextInput(locator, formatted, config);
    finalValue = await readDateValue(locator);
    if (finalValue) break;
    await randomDelay(config);
  }

  if (!finalValue) {
    throw new Error(`Date field did not accept "${formatted}" (from "${value}")`);
  }
  console.log(`  [fieldResolver] Set date to "${finalValue}"`);
}

async function fillPostalCode(
  form: FormScope,
  locator: Locator,
  value: string,
  config: AppConfig,
  addressHint = "",
  provinceHint = ""
): Promise<void> {
  await locator.waitFor({ state: "visible", timeout: 15000 });
  await locator.scrollIntoViewIfNeeded();

  const expectedCode = restorePostalCode(value);
  const needles = postalSearchNeedles(value, addressHint, provinceHint);
  const codeDigits = expectedCode.replace(/\D/g, "");

  for (const needle of needles) {
    await locator.click({ timeout: 10000 });
    await locator.fill("");
    await locator.pressSequentially(needle, { delay: 40 });
    await randomDelay(config);

    const row = form
      .locator(".angucomplete-holder")
      .filter({ has: locator })
      .locator(".angucomplete-row")
      .first();
    try {
      await row.waitFor({ state: "visible", timeout: 8000 });
      await row.click();
      await randomDelay(config);
      const selected = (await locator.inputValue().catch(() => "")).replace(/\D/g, "");
      const codeNeedle = needle === expectedCode || needle.startsWith(`${expectedCode} `);
      if (selected.length >= 4 && (selected.includes(codeDigits) || !codeNeedle)) {
        if (!selected.includes(codeDigits) && !codeNeedle) {
          console.log(
            `  [fieldResolver] Picked postal ${selected} via place search "${needle}" (sheet had ${expectedCode})`
          );
        } else {
          console.log(`  [fieldResolver] Picked postal autocomplete for "${needle}"`);
        }
        return;
      }
      console.log(
        `  [fieldResolver] Postal autocomplete for "${needle}" did not lock code ${expectedCode} (got "${selected}") — trying next term`
      );
    } catch {
      // Try the next search term.
    }
  }

  throw new Error(`No postal autocomplete match for ${needles.join(" / ")}`);
}

export async function fillField(
  ctx: FillContext,
  target: FieldTarget,
  value: string,
  options?: { selectByIndex?: number; skipVerify?: boolean }
): Promise<boolean> {
  const { page, form, config, screenshotDir, warnings } = ctx;
  const { locator, strategy } = await resolveField(form, target);

  if (!locator) {
    const screenshotPath = `${screenshotDir}/missing-${target.name.replace(/\s+/g, "-")}.png`;
    await form.locator("body").screenshot({ path: screenshotPath }).catch(async () => {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    });
    const warning = createWarning(
      target.name,
      target.section,
      `Field not found after all lookup strategies`,
      screenshotPath
    );
    warnings.push(warning);

    if (config.strictMode) {
      throw new Error(`Strict mode: could not find field "${target.name}" in ${target.section}`);
    }
    return false;
  }

  const fieldType = target.type ?? "text";
  let activeLocator = locator;

  try {
    switch (fieldType) {
      case "select":
        if (options?.selectByIndex !== undefined) {
          const selectedText = await selectDropdownByIndex(locator, options.selectByIndex, config);
          if (!options.skipVerify && selectedText) {
            console.log(`  [verify] "${target.name}" => "${selectedText}" (index ${options.selectByIndex})`);
          }
        } else {
          await selectDropdownByText(form, locator, value, config);
        }
        break;
      case "radio":
        await selectRadioInGroup(form, target.labels[0], value, config);
        break;
      case "checkbox":
        if (value.toLowerCase() === "yes" || value.toLowerCase() === "true") {
          await locator.check();
        } else {
          await locator.uncheck().catch(() => locator.click());
        }
        break;
      case "postal":
        await fillPostalCode(form, locator, value, config, target.postalHint, target.postalProvince);
        break;
      case "date": {
        activeLocator = await resolveDateLocator(form, target, locator);
        await fillDateInput(activeLocator, value, config);
        break;
      }
      default:
        await fillTextInput(locator, value, config);
    }

    const shouldVerify =
      !options?.skipVerify && fieldType !== "radio" && (config.verifyFills || config.strictMode);
    if (shouldVerify) {
      const verified = await verifyFill(activeLocator, value, fieldType);
      if (!verified) {
        const actual = await readFieldValue(activeLocator);
        const msg = `Read-back mismatch for "${target.name}": expected "${value}", got "${actual}" (strategy: ${strategy})`;
        console.warn(`  [verify] ${msg}`);
        warnings.push(createWarning(target.name, target.section, msg));

        if (config.strictMode) {
          throw new Error(msg);
        }
        return false;
      }
      console.log(`  [verify] "${target.name}" OK`);
    }

    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(createWarning(target.name, target.section, msg));
    if (config.strictMode || fieldType === "postal" || fieldType === "select" || fieldType === "date") throw err;
    return false;
  }
}

/** Fill all radio buttons under a section heading with the same answer */
export async function fillRadioGroupSection(
  ctx: FillContext,
  sectionHeading: string,
  answer: "Yes" | "No",
  fieldPrefix: string
): Promise<void> {
  const { form, config } = ctx;
  const heading = form.getByText(new RegExp(sectionHeading, "i")).first();
  const container = heading.locator("xpath=ancestor::fieldset[1] | ancestor::section[1] | ancestor::div[contains(@class,'section')][1]").first();

  let scope = container;
  if ((await container.count()) === 0) {
    scope = form.locator("body");
  }

  const radios = scope.getByRole("radio", { name: new RegExp(`^${answer}$`, "i") });
  const count = await radios.count();
  console.log(`  [fieldResolver] Filling ${count} "${answer}" radios under "${sectionHeading}"`);

  for (let i = 0; i < count; i++) {
    await radios.nth(i).check({ force: true });
  }
}

export async function fillFieldByRoleName(
  ctx: FillContext,
  target: Omit<FieldTarget, "labels"> & { name: string; section: string },
  role: "textbox" | "combobox" | "spinbutton",
  accessibleName: string | RegExp,
  value: string,
  fieldType: FieldTarget["type"] = "text"
): Promise<boolean> {
  const fullTarget: FieldTarget = {
    ...target,
    labels: [typeof accessibleName === "string" ? accessibleName : accessibleName.source],
    role,
    type: fieldType,
  };
  return fillField(ctx, fullTarget, value);
}
