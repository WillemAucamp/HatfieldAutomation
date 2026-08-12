import type { Frame, Page } from "playwright";
import type { AppConfig } from "./types.js";
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
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Finance application iframe did not load");
}

export async function clickApplyForFinance(page: Page, config: AppConfig): Promise<Frame> {
  const applyLink = page.getByRole("link", { name: /apply for finance/i }).first();
  const applyButton = page.getByRole("button", { name: /apply for finance/i }).first();

  if (await applyLink.isVisible({ timeout: 5000 }).catch(() => false)) {
    await applyLink.click();
  } else if (await applyButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await applyButton.click();
  } else {
    await page.getByText(/apply for finance/i).first().click();
  }

  await randomDelay(config);
  return waitForFormFrame(page);
}

export async function clickNext(form: FormScope, config: AppConfig): Promise<void> {
  const next = form.locator("button:visible").filter({ hasText: /^next$/i }).first();
  await next.waitFor({ state: "visible", timeout: 15000 });
  await next.click();
  await form.waitForLoadState("networkidle").catch(() => undefined);
  await randomDelay(config);
}

export async function screenshotSection(
  page: Page,
  form: FormScope,
  dir: string,
  section: string,
  phase: "before" | "after"
): Promise<string> {
  const path = `${dir}/section-${section}-${phase}.png`;
  // Capture iframe content when available, otherwise full page
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
    await radio.scrollIntoViewIfNeeded();
    await radio.check({ force: true });
    await randomDelay(config);
  }
}

export async function fillSelectByVisibleText(
  form: FormScope,
  config: AppConfig,
  selectLocator: string,
  value: string
): Promise<void> {
  const select = form.locator(selectLocator);
  await select.scrollIntoViewIfNeeded().catch(() => undefined);

  const selected = await select.evaluate((el, search) => {
    const sel = el as HTMLSelectElement;
    for (const opt of Array.from(sel.options)) {
      if (opt.text.trim().toLowerCase() === search.toLowerCase()) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        sel.dispatchEvent(new Event("input", { bubbles: true }));
        return opt.text;
      }
    }
    for (const opt of Array.from(sel.options)) {
      if (opt.text.toLowerCase().includes(search.toLowerCase())) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        sel.dispatchEvent(new Event("input", { bubbles: true }));
        return opt.text;
      }
    }
    return null;
  }, value);

  if (!selected) {
    throw new Error(`No option matching "${value}" in ${selectLocator}`);
  }
  console.log(`  [formUtils] Selected "${selected}" in ${selectLocator}`);
  await randomDelay(config);
}

export type FormScope = Page | Frame;
