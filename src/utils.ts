import { randomInt } from "node:crypto";
import type { Page } from "playwright";
import type { AppConfig } from "./types.js";

export async function randomDelay(config: AppConfig): Promise<void> {
  const min = config.actionDelayMin;
  const max = Math.max(config.actionDelayMin, config.actionDelayMax);
  const ms = randomInt(min, max + 1);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function screenshotPage(page: Page, dir: string, name: string): Promise<string> {
  const path = `${dir}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  return path;
}
