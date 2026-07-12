export function splitAmountNumber(value) {
  const parsed = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createInitialSplitParts(operation) {
  const totalCents = Math.round(splitAmountNumber(operation?.amount) * 100);
  const firstCents = Math.ceil(totalCents / 2);
  const secondCents = totalCents - firstCents;
  const base = {
    workspace_id: operation?.workspace_id || '',
    account_id: operation?.account_id || '',
    category_id: operation?.category_id || '',
    counterparty_id: operation?.counterparty_id || '',
  };

  return [
    { ...base, key: globalThis.crypto.randomUUID(), amount: (firstCents / 100).toFixed(2) },
    { ...base, key: globalThis.crypto.randomUUID(), amount: (secondCents / 100).toFixed(2) },
  ];
}

export function splitPartsMatchTotal(parts, totalAmount) {
  if (!Array.isArray(parts) || parts.length < 2) return false;
  const totalCents = Math.round(splitAmountNumber(totalAmount) * 100);
  const partCents = parts.map((part) => Math.round(splitAmountNumber(part.amount) * 100));
  return partCents.every((amount) => amount > 0)
    && partCents.reduce((sum, amount) => sum + amount, 0) === totalCents;
}
