import type { CatalogCompany, CompanyV2, PeriodV2 } from "../../src/features/finance/v2-types";
import { precise } from "./business-v2";
import type { ParsedFiling } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { validateV2 } from "./v2-model";

const revenueTags = [
  "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
  "us-gaap:RevenuesNetOfInterestExpense",
  "us-gaap:Revenues",
  "us-gaap:SalesRevenueNet",
  "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
  "ifrs-full:Revenue"
];
const date = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

/** Private candidate for a filing not yet represented in Company Facts. Dates
 * and revenue come from the filing, not a calculated quarter or prior report.
 * This candidate alone is never published: a source reader must validate a
 * consolidated flow or a complete business partition first.
 */
export function currentFilingCandidates(
  identity: CatalogCompany,
  filing: SecFiling,
  parsed: ParsedFiling,
  existing: PeriodV2[],
  industrySic?: string
): PeriodV2[] {
  if (!/^(10-K|10-Q)(\/A)?$/.test(filing.form)) return [];
  const url = new URL(filing.sourceUrl);
  if (
    !/^\d{10}$/.test(identity.cik) ||
    url.origin !== "https://www.sec.gov" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(
      `/Archives/edgar/data/${Number(identity.cik)}/${filing.accession.replaceAll("-", "")}/`
    ) ||
    parsed.facts.some(
      (f) => !/^\d+$/.test(f.context.cik) || Number(f.context.cik) !== Number(identity.cik)
    )
  )
    throw new Error("Current filing source identity mismatch.");
  const today = new Date().toISOString().slice(0, 10);
  const annual = /^10-K/.test(filing.form);
  if (
    !date(filing.reportDate) ||
    !date(filing.filedAt) ||
    filing.reportDate > filing.filedAt ||
    filing.filedAt > today ||
    parsed.periodEnd !== filing.reportDate ||
    !Number.isInteger(parsed.fiscalYear) ||
    parsed.fiscalYear <= 1990 ||
    parsed.fiscalYear > Number(today.slice(0, 4)) + 1 ||
    Math.abs(parsed.fiscalYear - Number(filing.reportDate.slice(0, 4))) > 1 ||
    (annual ? parsed.fiscalPeriod !== "FY" : !/^Q[1-4]$/.test(parsed.fiscalPeriod))
  )
    return [];
  const kind = annual ? "annual" : "quarterly";
  const facts = parsed.facts.filter((f) => {
    const start = f.context.start ?? "";
    const days = (Date.parse(filing.reportDate) - Date.parse(start)) / 86400000;
    return (
      f.context.end === filing.reportDate &&
      date(start) &&
      (annual ? days >= 330 && days <= 400 : days >= 75 && days <= 105) &&
      f.currency === "USD" &&
      !f.context.typed &&
      !Object.keys(f.context.dimensions).length &&
      Number.isFinite(f.value)
    );
  });
  // Financial SIC 73xx denotes business services; an unknown financial scope
  // cannot use a fee/contract sub-line as total company revenue.
  const tags =
    identity.sector === "Financials"
      ? [
          "us-gaap:RevenuesNetOfInterestExpense",
          "us-gaap:Revenues",
          ...(/^73\d{2}$/.test(industrySic ?? "") ? revenueTags : [])
        ]
      : revenueTags;
  const tag = tags.find((t) => facts.some((f) => f.tag === t));
  if (!tag) return [];
  const copies = facts.filter((f) => f.tag === tag);
  const starts = new Set(copies.map((f) => f.context.start));
  if (starts.size !== 1) return [];
  const revenue = precise(copies);
  if (!revenue || revenue.value <= 0) return [];
  const startDate = revenue.context.start!;
  if (
    existing.some(
      (p) =>
        p.kind === kind &&
        p.startDate === startDate &&
        p.endDate === filing.reportDate &&
        p.accession === filing.accession
    )
  )
    return [];
  const fiscalQuarter = annual
    ? undefined
    : (Number(parsed.fiscalPeriod.slice(1)) as 1 | 2 | 3 | 4);
  const id = annual ? `FY${parsed.fiscalYear}` : `${parsed.fiscalYear}-Q${fiscalQuarter}`;
  // A competing date interpretation for the same fiscal label is ambiguous.
  if (
    existing.some(
      (p) => p.id === id && (p.startDate !== startDate || p.endDate !== filing.reportDate)
    )
  )
    return [];
  return [
    {
      id,
      label: annual ? `FY ${parsed.fiscalYear}` : `Q${fiscalQuarter} FY${parsed.fiscalYear}`,
      kind,
      fiscalYear: parsed.fiscalYear,
      fiscalQuarter,
      startDate,
      endDate: filing.reportDate,
      filedAt: filing.filedAt,
      accession: filing.accession,
      sourceUrl: filing.sourceUrl,
      reportingCurrency: "USD",
      displayCurrency: "USD",
      derived: false,
      metrics: { revenue: revenue.value },
      metricSources: {
        revenue: {
          label: "Reported revenue",
          tag: revenue.tag,
          accession: filing.accession,
          filedAt: filing.filedAt,
          sourceUrl: filing.sourceUrl,
          method: "reported",
          decimals: revenue.decimals
        }
      },
      coverage: { basics: true, segments: false, sankey: false }
    }
  ];
}

/** A first publication still requires nonempty, validated source periods. */
export function companyFromFilingPeriods(
  identity: CatalogCompany,
  periods: PeriodV2[],
  warnings: string[] = []
): CompanyV2 {
  const latest = [...periods].sort((a, b) => a.endDate.localeCompare(b.endDate)).at(-1);
  if (!latest) throw new Error("No validated source periods to publish.");
  const company: CompanyV2 = {
    schemaVersion: 2,
    ticker: identity.ticker,
    name: identity.name,
    cik: identity.cik,
    accent: "#337d9f",
    reportingCurrency: latest.reportingCurrency,
    latestPeriod: latest.label,
    dataStatus: "verified",
    version: "pending",
    updatedAt: new Date().toISOString(),
    annual: periods.filter((p) => p.kind === "annual"),
    quarterly: periods.filter((p) => p.kind === "quarterly"),
    warnings: [
      ...new Set([
        ...warnings,
        "History is source-available, not necessarily continuous; missing quarters and shorter reporting histories are not estimated."
      ])
    ]
  };
  validateV2(company);
  return company;
}

export function missingStandardHistory(error: unknown) {
  return (
    error instanceof Error &&
    error.message.startsWith("No supported, source-linked monetary periods were found.")
  );
}
