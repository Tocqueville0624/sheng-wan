import type { CatalogCompany, CompanyV2 } from "../../src/features/finance/v2-types";
import type { SecFiling } from "./sec-shared";

/** Security share classes share one issuer; no issuer is silently dropped. */
export function uniqueIssuers(companies: CatalogCompany[]) {
  const issuers = new Map<string, { identity: CatalogCompany; tickers: string[] }>();
  for (const company of companies) {
    if (!/^\d{10}$/.test(company.cik)) throw new Error(`Invalid CIK: ${company.ticker}`);
    const entry = issuers.get(company.cik);
    if (entry) entry.tickers.push(company.ticker);
    else issuers.set(company.cik, { identity: company, tickers: [company.ticker] });
  }
  return [...issuers.values()];
}

/** Acquire latest history and explicit current filings, even when standard facts lag. */
export function corpusFilings(filings: SecFiling[], supplement: SecFiling[] = []) {
  const select = (forms: RegExp, count: number) => {
    const dates = new Set<string>();
    return filings
      .filter((f) => forms.test(f.form))
      .sort(
        (a, b) => b.reportDate.localeCompare(a.reportDate) || b.filedAt.localeCompare(a.filedAt)
      )
      .filter((f) => {
        if (dates.has(f.reportDate)) return false;
        dates.add(f.reportDate);
        return true;
      })
      .slice(0, count);
  };
  const target = [
    ...select(/^(10-K|20-F)(\/A)?$/, 10),
    ...select(/^(10-Q|6-K)(\/A)?$/, 20),
    ...supplement
  ];
  return [...new Map(target.map((f) => [f.accession, f])).values()].sort((a, b) =>
    b.reportDate.localeCompare(a.reportDate)
  );
}

/** Completion cannot be inferred from a successful HTTP download or old facts.
 * Current sources and every retained period must have both validated capabilities.
 */
export function corpusAcceptance(
  company: CompanyV2,
  targets: SecFiling[],
  download: string,
  warnings: string[]
) {
  const gaps: string[] = [];
  if (download !== "downloaded") gaps.push("Raw-source acquisition is incomplete.");
  for (const [kind, forms, periods] of [
    ["annual", /^(10-K|20-F)(\/A)?$/, company.annual],
    ["quarterly", /^(10-Q|6-K)(\/A)?$/, company.quarterly]
  ] as const) {
    const current = targets
      .filter((f) => forms.test(f.form))
      .sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0];
    if (
      current &&
      !periods.some((p) => p.endDate === current.reportDate && p.filedAt >= current.filedAt)
    )
      gaps.push(`Current ${kind} source ${current.reportDate} has no parsed period.`);
    for (const p of periods) {
      if (!p.coverage.sankey) gaps.push(`${p.id}: profit flow is unavailable.`);
      if (!p.coverage.segments) gaps.push(`${p.id}: business revenue partition is unavailable.`);
    }
  }
  if (!company.annual.length && !company.quarterly.length) gaps.push("No periods were parsed.");
  gaps.push(...warnings.filter((w) => /^\d{4}-\d{2}-\d{2}:/.test(w)));
  return { complete: !gaps.length, gaps };
}
