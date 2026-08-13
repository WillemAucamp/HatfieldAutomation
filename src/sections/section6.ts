import type { FillContext } from "../fieldResolver.js";
import { clickNext, screenshotSection } from "../formUtils.js";
import { parseReferenceNumber } from "../reference.js";
import { randomDelay } from "../utils.js";

const SECTION = "section6";

export async function runSection6(ctx: FillContext): Promise<string> {
  const { page, form, config } = ctx;

  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "before");

  const finish = form.locator("button:visible").filter({ hasText: /^finish$/i }).first();
  await finish.waitFor({ state: "visible", timeout: 15000 });
  await finish.click();
  console.log("  [section6] Clicked FINISH");
  await randomDelay(config);

  const reference = await waitForReference(ctx);
  await screenshotSection(page, form, ctx.screenshotDir, SECTION, "after");
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
        if (await ok.isVisible({ timeout: 2000 }).catch(() => false)) {
          await ok.click();
          await randomDelay(config);
        }
        return parsed;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error("Finish was clicked but no application reference number appeared in the popup");
}

/** Advance from Section 5 onto Upload Documents, then submit. */
export async function goToUploadDocumentsThenSubmit(ctx: FillContext): Promise<string> {
  await clickNext(ctx.form, ctx.config);
  await ctx.form.waitForLoadState("networkidle").catch(() => undefined);
  return runSection6(ctx);
}
