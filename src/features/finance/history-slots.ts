import type { PeriodV2 } from "./v2-types";

/** Missing fiscal periods occupy an empty slot, never a fabricated data point. */
export function historySlots(periods: PeriodV2[]) {
  const quarterly = periods[0]?.kind === "quarterly";
  const key = (p: PeriodV2) =>
    quarterly ? p.fiscalYear * 4 + (p.fiscalQuarter ?? 1) - 1 : p.fiscalYear;
  const known = new Map(periods.map((p) => [key(p), p]));
  if (!known.size) return [];
  const first = Math.min(...known.keys()),
    last = Math.max(...known.keys());
  return Array.from({ length: Math.min(120, last - first + 1) }, (_, i) => {
    const n = first + i;
    return {
      fiscalYear: quarterly ? Math.floor(n / 4) : n,
      fiscalQuarter: quarterly ? (n % 4) + 1 : undefined,
      period: known.get(n)
    };
  });
}
