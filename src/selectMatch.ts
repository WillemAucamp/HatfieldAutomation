import { expandSelectNeedles } from "./transforms.js";

export type SelectOption = { value: string; text: string };
export type RankedSelectOption = SelectOption & { textNorm: string };

export function normalizeSelectText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function usableSelectOptions(options: SelectOption[]): RankedSelectOption[] {
  return options
    .filter((opt) => {
      const text = opt.text.trim();
      if (!text) return false;
      if (text === "......" || text === "-" || text === "—") return false;
      if (/^select\b/i.test(text)) return false;
      return true;
    })
    .map((opt) => ({ ...opt, textNorm: normalizeSelectText(opt.text) }));
}

export function pickSelectOption(
  options: SelectOption[],
  value: string
): RankedSelectOption | null {
  const usable = usableSelectOptions(options);
  const needles = expandSelectNeedles(value).map(normalizeSelectText).filter(Boolean);
  if (!usable.length || !needles.length) return null;

  for (const needle of needles) {
    const exact = usable.find((opt) => opt.textNorm === needle);
    if (exact) return exact;
  }
  for (const needle of needles) {
    const partial = usable.find((opt) => opt.textNorm.includes(needle));
    if (partial) return partial;
  }
  for (const needle of needles) {
    const reverse = usable.find(
      (opt) => needle.includes(opt.textNorm) && opt.textNorm.length >= 3
    );
    if (reverse) return reverse;
  }
  for (const needle of needles) {
    const tokens = needle.split(" ").filter((token) => token.length >= 3);
    if (!tokens.length) continue;
    const overlap = usable.find((opt) => tokens.every((token) => opt.textNorm.includes(token)));
    if (overlap) return overlap;
  }
  return null;
}

export function firstUsableSelectOption(options: SelectOption[]): RankedSelectOption | null {
  return usableSelectOptions(options)[0] ?? null;
}

export function formatMissingOptionError(
  field: string,
  value: string,
  options: SelectOption[]
): string {
  const names = usableSelectOptions(options)
    .map((opt) => opt.text)
    .slice(0, 8);
  const available = names.length ? ` Available: ${names.join(" | ")}` : " Dropdown was empty.";
  const label = field.trim() || "dropdown";
  return `No option matching "${value}" in ${label}.${available}`;
}
