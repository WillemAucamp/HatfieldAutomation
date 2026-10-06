/** Pull simple R-amounts from the free-text Form expenses summary. */
export function parseExpenseSummary(summary: string): {
  food?: string;
  telephone?: string;
  transport?: string;
} {
  const text = String(summary ?? "");
  if (!text.trim()) return {};
  const out: { food?: string; telephone?: string; transport?: string } = {};
  const norm = (raw: string) => raw.replace(/[^\d.]/g, "");

  const food = text.match(/food\s*[:=]?\s*R?\s*([\d][\d\s,.]*)/i);
  const accounts = text.match(/accounts?\s*[:=]?\s*R?\s*([\d][\d\s,.]*)/i);
  const phone = text.match(
    /(?:cell\s*phone|cellphone|telephone|phone|mobile)\s*[:=]?\s*R?\s*([\d][\d\s,.]*)/i
  );
  const transport = text.match(
    /(?:transport|petrol|fuel|taxi|uber)\s*[:=]?\s*R?\s*([\d][\d\s,.]*)/i
  );
  const household = text.match(
    /(?:wifi|electricity|water|other|rent)\s*[:=]?\s*R?\s*([\d][\d\s,.]*)/gi
  );

  if (food) out.food = norm(food[1]);
  if (phone) out.telephone = norm(phone[1]);
  else if (accounts) out.telephone = norm(accounts[1]);
  if (transport) out.transport = norm(transport[1]);
  else if (household) {
    // Seriti only has Telephone / Transport / Food — fold remaining household lines into transport.
    const total = household
      .map((chunk) => {
        const m = chunk.match(/([\d][\d\s,.]*)/);
        return m ? Number(norm(m[1])) : 0;
      })
      .filter((n) => Number.isFinite(n) && n > 0)
      .reduce((a, b) => a + b, 0);
    if (total > 0) out.transport = String(total);
  }
  return out;
}
