/** Extract the application reference from the success popup text. */
export function parseReferenceNumber(text: string): string | null {
  const labeled = text.match(/reference number is\s*:?\s*([A-Z]{2,}\d+)/i);
  if (labeled?.[1]) return labeled[1].toUpperCase();

  const zaht = text.match(/ZAHTVW\d+/i);
  if (zaht) return zaht[0].toUpperCase();

  const generic = text.match(/\b([A-Z]{4,}\d{6,})\b/);
  if (generic?.[1]) return generic[1].toUpperCase();

  return null;
}
