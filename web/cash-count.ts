export const cashGroups = [
  { name: "Billetes", singular: "billetes", values: [20000, 10000, 5000, 2000, 1000] },
  { name: "Monedas", singular: "monedas", values: [500, 100, 50, 25, 10] },
] as const;
export type CashCounts = Record<number, string>;
export function cashQuantity(value = ""): number | null {
  if (value === "") return 0;
  return /^\d{1,7}$/.test(value) && Number(value) <= 1000000 ? Number(value) : null;
}
export function cashTotal(values: readonly number[], counts: CashCounts): number | null {
  let total = 0;
  for (const value of values) {
    const quantity = cashQuantity(counts[value]);
    if (quantity === null) return null;
    total += value * quantity;
  }
  return total;
}
export const cashMoney = (value: number) => new Intl.NumberFormat("es-CR", {
  style: "currency", currency: "CRC", maximumFractionDigits: 0,
}).format(value);
