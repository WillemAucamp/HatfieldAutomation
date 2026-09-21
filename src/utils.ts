import { randomInt } from "node:crypto";
import type { Page } from "playwright";
import type { AppConfig } from "./types.js";

export async function randomDelay(config: AppConfig): Promise<void> {
  const min = Math.max(0, config.actionDelayMin);
  const max = Math.max(min, config.actionDelayMax);
  if (max === 0) return;
  const ms = min === max ? min : randomInt(min, max + 1);
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function screenshotPage(page: Page, dir: string, name: string): Promise<string> {
  const path = `${dir}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  return path;
}
