import type { Frame, Locator, Page } from "playwright";
import type { AppConfig } from "./types.js";
import {
  firstUsableSelectOption,
  formatMissingOptionError,
  pickSelectOption,
  type SelectOption,
} from "./selectMatch.js";
import { normalizeAddressLine } from "./transforms.js";
import { randomDelay } from "./utils.js";

const FORM_FRAME_PATTERN = /seritisolutions/i;

export async function waitForFormFrame(page: Page, timeoutMs = 30000): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = page.frame({ url: FORM_FRAME_PATTERN });
    if (frame) {
      await frame.waitForLoadState("domcontentloaded").catch(() => undefined);
      return frame;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Finance application iframe did not load");
}

export async function clickApplyForFinance(page: Page, config: AppConfig): Promise<Frame> {
  const applyLink = page.getByRole("link", { name: /apply for finance/i }).first();
  const applyButton = page.getByRole("button", { name: /apply for finance/i }).first();

  // Cookie banners may block the click transition into the form.
  await page
    .getByRole("button", { name: /got it|accept|accept cookies/i })
    .first()
    .click({ timeout: 5000 })
    .catch(() => undefined);

  // Sometimes the initial click doesn't transition into the actual application form.
  // Retry a few times and only return once the applicant type control is visible in-frame.
  let lastFrame: Frame | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await applyLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await applyLink.click().catch(() => undefined);
    } else if (await applyButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await applyButton.click().catch(() => undefined);
    } else {
      await page.getByText(/apply for finance/i).first().click().catch(() => undefined);
    }

    await randomDelay(config);
    try {
      lastFrame = await waitForFormFrame(page);
    } catch (e) {
      // If the iframe didn't appear, try the next click attempt.
      continue;
    }

    const applicantTypeLabel = lastFrame
      .locator("label")
      .filter({ hasText: /Private Individual|Private|Individual/i })
      .first();
    const applicantTypeRadio = lastFrame
      .getByRole("radio", { name: /Private Individual|Private|Individual/i })
      .first();

    if (
      (await applicantTypeLabel.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) ||
      (await applicantTypeRadio
        .waitFor({ state: "visible", timeout: 5000 })
        .then(() => true)
        .catch(() => false))
    ) {
      return lastFrame;
    }
  }

  if (!lastFrame) {
    // Final fallback (will throw if iframe never loads)
    return waitForFormFrame(page);
  }
  return lastFrame;
}

export async function waitForHeading(form: FormScope, pattern: RegExp, timeoutMs = 20000): Promise<void> {
  await form
    .getByText(pattern)
    .filter({ visible: true })
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs });
}

export async function waitForSelectorVisible(
  form: FormScope,
  selector: string,
  timeoutMs = 20000
): Promise<void> {
  await form
    .locator(selector)
    .filter({ visible: true })
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs });
}

export async function waitForVisibleButton(
  form: FormScope,
  label: RegExp,
  timeoutMs = 20000
): Promise<void> {
  await form
    .locator("button")
    .filter({ hasText: label })
    .filter({ visible: true })
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs });
}

export async function clickNext(form: FormScope, config: AppConfig): Promise<void> {
  const next = form.locator("button:visible").filter({ hasText: /^next$/i }).first();
  await next.waitFor({ state: "visible", timeout: 15000 });
  await next.click();
}

/** After postal autocomplete, derive a short address line from the selected suburb. */
export async function syncAddressFromPostal(
  form: FormScope,
  postalFieldIdSuffix: string,
  fallback: string
): Promise<string> {
  const postal = await form
    .locator(`[id$="${postalFieldIdSuffix}"]`)
    .filter({ visible: true })
    .first()
    .inputValue()
    .catch(() => "");
  const suburb = postal.split(",")[0]?.trim();
  return suburb || normalizeAddressLine(fallback);
}

export async function screenshotSection(
  page: Page,
  form: FormScope,
  dir: string,
  section: string,
  phase: "before" | "after",
  config?: AppConfig
): Promise<string> {
  if (config && !config.screenshots) return "";
  const path = `${dir}/section-${section}-${phase}.png`;
  try {
    await form.locator("body").screenshot({ path });
  } catch {
    await page.screenshot({ path, fullPage: true });
  }
  return path;
}

export function isUploadDocumentsSection(pageText: string): boolean {
  return /upload documents/i.test(pageText);
}

export async function getVisibleStepText(form: FormScope): Promise<string> {
  return (await form.locator("body").innerText()) ?? "";
}

/** Fill consecutive radio groups within the visible form, selecting yes/no by index within each group */
export async function fillRadioGroupsByAnswer(
  form: FormScope,
  config: AppConfig,
  groupCount: number,
  answer: "Yes" | "No",
  startGroupIndex = 0,
  scopeSelector = 'form[name="qualifyingCriteriaForm"]'
): Promise<void> {
  const scope = form.locator(scopeSelector);
  const radios = scope.locator('input[type="radio"]:visible');
  const names = await radios.evaluateAll((els) => {
    const seen: string[] = [];
    for (const el of els) {
      const name = (el as HTMLInputElement).name;
      if (name && !seen.includes(name)) seen.push(name);
    }
    return seen;
  });

  const answerIndex = answer.toLowerCase() === "yes" ? 0 : 1;
  const slice = names.slice(startGroupIndex, startGroupIndex + groupCount);

  for (const name of slice) {
    const radio = scope.locator(`input[type="radio"][name="${name}"]`).nth(answerIndex);
    await radio.check({ force: true });
  }
}

export async function fillSelectByVisibleText(
  form: FormScope,
  config: AppConfig,
  selectLocator: string,
  value: string,
  fieldName = selectLocator
): Promise<void> {
  const select = form.locator(selectLocator).filter({ visible: true }).first();
  await select.waitFor({ state: "visible", timeout: 15000 });
  await select.scrollIntoViewIfNeeded().catch(() => undefined);

  const match = await matchSelectOption(select, value, { fieldName });
  await select.selectOption({ value: match.value });
  await select.evaluate((el) => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  console.log(`  [formUtils] Selected "${match.text}" in ${selectLocator}`);
}

async function readSelectOptions(locator: Locator): Promise<SelectOption[]> {
  return locator.evaluate((el) =>
    Array.from((el as HTMLSelectElement).options).map((opt) => ({
      value: opt.value,
      text: opt.text.trim(),
    }))
  );
}

export async function waitForSelectOptions(
  locator: Locator,
  timeoutMs = 8000
): Promise<void> {
  await locator.waitFor({ state: "visible", timeout: timeoutMs }).catch(() => undefined);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const options = await readSelectOptions(locator).catch(() => []);
    if (firstUsableSelectOption(options)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

export async function matchSelectOption(
  locator: Locator,
  value: string,
  options: { fieldName?: string; fallbackToFirst?: boolean } = {}
): Promise<{ value: string; text: string }> {
  let list = await readSelectOptions(locator);
  if (!firstUsableSelectOption(list)) {
    await waitForSelectOptions(locator, 5000);
    list = await readSelectOptions(locator);
  }

  const match = pickSelectOption(list, value);
  if (match) return match;

  if (options.fallbackToFirst) {
    const fallback = firstUsableSelectOption(list);
    if (fallback) {
      console.warn(
        `  [formUtils] No option matching "${value}" in ${options.fieldName || "dropdown"}; using "${fallback.text}"`
      );
      return fallback;
    }
  }

  throw new Error(formatMissingOptionError(options.fieldName || "dropdown", value, list));
}

export async function readVisibleAlerts(form: FormScope): Promise<string> {
  const locators = [
    form.locator('[role="alert"]'),
    form.locator(".field-validation-error"),
    form.locator(".text-danger"),
    form.locator(".alert-danger"),
    form.locator(".help-block"),
  ];
  const texts: string[] = [];
  for (const loc of locators) {
    const count = await loc.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 6); i++) {
      const raw = await loc.nth(i).innerText().catch(() => "");
      const text = raw.replace(/\s+/g, " ").trim();
      if (text && text.length < 160 && !texts.includes(text)) texts.push(text);
    }
  }
  return texts.slice(0, 4).join("; ");
}

export async function clickNextAndWait(
  form: FormScope,
  config: AppConfig,
  nextSelector: string,
  sectionLabel: string
): Promise<void> {
  await clickNext(form, config);
  try {
    await waitForSelectorVisible(form, nextSelector, 20000);
  } catch (err) {
    const alerts = await readVisibleAlerts(form);
    const timeout = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${sectionLabel} Next did not open the next page.` +
        (alerts ? ` Form said: ${alerts}.` : "") +
        ` Waiting for ${nextSelector}. ${timeout}`
    );
  }
}

export type FormScope = Page | Frame;
