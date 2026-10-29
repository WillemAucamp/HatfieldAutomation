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

export type FormScope = Page | Frame;

const FORM_FRAME_PATTERN = /seritisolutions/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Cookie overlay can sit on top of Apply for Finance and the Seriti iframe. */
export async function dismissCookieBanners(page: Page): Promise<void> {
  const locators = [
    page.locator("button").filter({ hasText: /got it/i }),
    page.getByRole("button", { name: /^(got it|accept cookies|accept)$/i }),
  ];
  for (const locator of locators) {
    const button = locator.first();
    if (await button.isVisible({ timeout: 4000 }).catch(() => false)) {
      await button.click({ timeout: 5000 }).catch(() => undefined);
      await sleep(400);
      return;
    }
  }
}

/**
 * Seriti sometimes skips the applicant-type radio and opens on email, and the
 * email field can exist in the DOM while a loader/404 placeholder is showing.
 * Wait until a usable first step is actually visible.
 */
export async function waitForFinanceFormReady(
  form: FormScope,
  timeoutMs = 25000
): Promise<"email" | "applicant-type"> {
  const deadline = Date.now() + timeoutMs;
  const email = form.locator('[id="txtEmailAddress"]').first();
  const applicantLabel = form.locator("label").filter({ hasText: /Private Individual/i }).first();
  const applicantRadio = form.getByRole("radio", { name: /Private Individual/i }).first();
  let saw404At = 0;
  const hint = " Not a sheet cell. Clear Status, run load-only.";
  while (Date.now() < deadline) {
    const applicantVisible =
      (await applicantLabel.isVisible().catch(() => false)) ||
      (await applicantRadio.isVisible().catch(() => false));
    if (applicantVisible) return "applicant-type";
    const emailVisible = await email.isVisible().catch(() => false);
    if (emailVisible) {
      saw404At = 0;
      return "email";
    }
    // A hidden txtEmailAddress sits in the DOM while the SPA is still routing.
    // Counting that as ready made every row time out on the same invisible field.
    const bodyNow = ((await form.locator("body").innerText().catch(() => "")) || "")
      .replace(/\s+/g, " ")
      .trim();
    if (/\b404\b/.test(bodyNow)) {
      if (!saw404At) saw404At = Date.now();
      else if (Date.now() - saw404At > 8000) {
        throw new Error(
          `Seriti finance form did not open (iframe 404).${hint}`
        );
      }
    } else {
      saw404At = 0;
    }
    await sleep(200);
  }
  const body = ((await form.locator("body").innerText().catch(() => "")) || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  if (/\b404\b/.test(body)) {
    throw new Error(`Seriti finance form did not open (iframe 404).${hint}`);
  }
  throw new Error(
    `Seriti finance form did not open (no applicant type or email field).${hint}` +
      (body ? ` Visible text: ${body}` : "")
  );
}

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

/**
 * VW Melrose still embeds CompanyCode=IXWS. Seriti now rejects that code
 * ("not a valid child company of EXFA") and the iframe 404s before email.
 * The same UniqueCode validates under HATF as branch HTVW022.
 */
function useHatfCompanyCode(url: string): string {
  return url.replace(/CompanyCode=IXWS/gi, "CompanyCode=HATF");
}

async function rewriteRetiredCompanyCode(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      for (const frame of document.querySelectorAll("iframe")) {
        const src = frame.getAttribute("src") || "";
        if (/CompanyCode=IXWS/i.test(src)) {
          frame.setAttribute("src", src.replace(/CompanyCode=IXWS/gi, "CompanyCode=HATF"));
        }
      }
    })
    .catch(() => undefined);

  for (const frame of page.frames()) {
    const url = frame.url();
    const retired = /CompanyCode=IXWS/i.test(url);
    const notFound = /\/app\/404/i.test(url);
    if (!retired && !notFound) continue;
    const parentSrc = await frame
      .frameElement()
      .then((el) => el.getAttribute("src"))
      .catch(() => "");
    const next = useHatfCompanyCode(retired ? url : parentSrc || "");
    if (next.includes("CompanyCode=HATF") && next !== url) {
      await frame.goto(next, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => undefined);
    }
  }
}

export async function clickApplyForFinance(page: Page, config: AppConfig): Promise<Frame> {
  const applyLink = page.getByRole("link", { name: /apply for finance/i }).first();
  const applyButton = page.getByRole("button", { name: /apply for finance/i }).first();

  await dismissCookieBanners(page);
  await rewriteRetiredCompanyCode(page);
  await sleep(500);

  // One Apply click, then wait. Re-clicking while the SPA is routing resets
  // the iframe back to a 404 placeholder.
  const clickApply = async () => {
    if (await applyLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await applyLink.click().catch(() => undefined);
    } else if (await applyButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await applyButton.click().catch(() => undefined);
    } else {
      await page.getByText(/apply for finance/i).first().click().catch(() => undefined);
    }
    await randomDelay(config);
  };

  let lastError = "Finance application iframe did not load";
  const seritiSaid = watchCompanyCodeRejection(page);
  for (let attempt = 1; attempt <= 2; attempt++) {
    await rewriteRetiredCompanyCode(page);
    if (!page.frame({ url: FORM_FRAME_PATTERN }) || attempt > 1) {
      await clickApply();
      await rewriteRetiredCompanyCode(page);
    }
    let frame: Frame;
    try {
      frame = await waitForFormFrame(page);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      continue;
    }
    try {
      await waitForFinanceFormReady(frame, 25000);
      return frame;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  const said = seritiSaid().replace(/\.+$/, "");
  throw new Error(said ? `${lastError} Seriti said: ${said}.` : lastError);
}

/** Seriti validate 404: company code is not a child of EXFA. */
function watchCompanyCodeRejection(page: Page): () => string {
  let message = "";
  page.on("response", (response) => {
    if (!/financeapplication\/validate/i.test(response.url()) || response.status() < 400) return;
    void response
      .json()
      .then((body: unknown) => {
        const data = (body as { data?: unknown }).data ?? body;
        const text = Array.isArray(data) ? data.map(String).join("; ") : String(data ?? "");
        const compact = text.replace(/\s+/g, " ").trim();
        if (compact) message = compact.slice(0, 200);
      })
      .catch(() => undefined);
  });
  return () => message;
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

/**
 * Playwright's mouse click waits until the target stops moving. Seriti's
 * Angular form never settles, so that wait times out on the applicant-type
 * radio and on Next. A DOM click still runs the ng-click handler.
 */
export async function domClick(locator: Locator): Promise<void> {
  await locator.evaluate((el) => {
    const node = el as HTMLElement;
    node.scrollIntoView({ block: "center", inline: "nearest" });
    node.click();
  });
}

export async function clickNext(form: FormScope, config: AppConfig): Promise<void> {
  // Earlier wizard steps stay in the DOM. The current step's Next is the last visible one.
  const next = form.locator("button:visible").filter({ hasText: /^next$/i }).last();
  await next.waitFor({ state: "visible", timeout: 15000 });
  await domClick(next);
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
    await domClick(radio);
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
  await select.evaluate((el) => {
    (el as HTMLElement).scrollIntoView({ block: "center", inline: "nearest" });
  });

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
    const invalid = await form
      .locator(".ng-invalid:visible")
      .evaluateAll((els) =>
        els
          .map((el) => {
            const input = el as HTMLElement;
            const label = input.closest("label, .form-group, .row")?.textContent || "";
            const title = input.getAttribute("title") || input.getAttribute("name") || input.id;
            const text = (label || title || "").replace(/\s+/g, " ").trim();
            return text.slice(0, 80);
          })
          .filter(Boolean)
          .slice(0, 4)
      )
      .catch(() => [] as string[]);
    const visible = alerts
      ? ""
      : ((await form.locator("body").innerText().catch(() => "")) || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 140);
    const invalidText = invalid.length ? ` Invalid: ${invalid.join(" | ")}.` : "";
    throw new Error(
      `${sectionLabel} Next did not open the next page.` +
        (alerts ? ` Form said: ${alerts}.` : "") +
        invalidText +
        (visible ? ` Visible text: ${visible}.` : "") +
        ` Waiting for ${nextSelector}.`
    );
  }
}
