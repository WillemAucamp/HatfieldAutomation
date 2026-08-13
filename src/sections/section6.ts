import type { FillContext } from "../fieldResolver.js";
import { clickNext, screenshotSection, waitForVisibleButton } from "../formUtils.js";
import { parseReferenceNumber } from "../reference.js";

const SECTION = "section6";

export async function runSection6(ctx: FillContext): Promise<string> {
  const { page, form, config } = ctx;

  await waitForVisibleButton(form, /^finish$/i, 20000);
  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "before", config);
  const finish = form.locator("button").filter({ hasText: /^finish$/i }).filter({ visible: true }).first();
  await finish.waitFor({ state: "visible", timeout: 15000 });
  await finish.click();
  console.log("  [section6] Clicked FINISH");

  const reference = await waitForReference(ctx);
  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "after", config);
  return reference;
}

async function waitForReference(ctx: FillContext): Promise<string> {
  const { page, form, config } = ctx;
  const deadline = Date.now() + 45000;

  while (Date.now() < deadline) {
    const sources = [form, page] as const;
    for (const scope of sources) {
      const bodyText = (await scope.locator("body").innerText().catch(() => "")) ?? "";
      const parsed = parseReferenceNumber(bodyText);
      if (parsed) {
        console.log(`  [section6] Captured reference ${parsed}`);
        const ok = scope.getByRole("button", { name: /^ok$/i }).first();
        if (await ok.isVisible({ timeout: 500 }).catch(() => false)) {
          await ok.click();
        }
        return parsed;
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error("Finish was clicked but no application reference number appeared in the popup");
}

/** Advance from Section 5 onto Upload Documents, then submit. */
export async function goToUploadDocumentsThenSubmit(ctx: FillContext): Promise<string> {
  await clickNext(ctx.form, ctx.config);
  return runSection6(ctx);
}
