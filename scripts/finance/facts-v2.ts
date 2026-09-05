import type { CatalogCompany, CompanyV2, PeriodV2 } from "../../src/features/finance/v2-types";
import type { FinancialMetrics } from "../../src/features/finance/types";
import type { SecFiling } from "./sec-shared";
import { statementPeriod, validateV2 } from "./v2-model";
import { buildStatementFlow } from "../../src/features/finance/chart-model";
import { roundingTolerance } from "./validate";

export type Fact = {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy?: number;
  fp?: string;
  form: string;
  filed: string;
};
export type FactsDocument = {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, { label: string | null; units: Record<string, Fact[]> }>>;
};
const tags: Partial<Record<keyof FinancialMetrics, string[]>> = {
  revenue: [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractsWithCustomers",
    "RevenuesNetOfInterestExpense",
    "Revenues",
    "SalesRevenueNet",
    "Revenue"
  ],
  costOfRevenue: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfSales"],
  grossProfit: ["GrossProfit"],
  operatingExpenses: ["OperatingExpenses", "OperatingExpense"],
  operatingIncome: ["OperatingIncomeLoss", "ProfitLossFromOperatingActivities"],
  pretaxIncome: [
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    "ProfitLossBeforeTax"
  ],
  incomeTax: [
    "IncomeTaxExpenseBenefit",
    "IncomeTaxExpenseContinuingOperations",
    "IncomeTaxExpense"
  ],
  netIncome: ["NetIncomeLoss", "ProfitLoss"],
  researchAndDevelopment: ["ResearchAndDevelopmentExpense"],
  sellingGeneralAndAdministrative: ["SellingGeneralAndAdministrativeExpense"]
};

/** Select concepts before JSON parsing to bound Company Facts object allocation. */
export function parseFactsDocument(source: string): FactsDocument {
  const objectEnd = (start: number) => {
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let i = start; i < source.length; i++) {
      const c = source[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return i + 1;
    }
    throw new Error("Truncated Company Facts JSON.");
  };
  const cik = Number(source.match(/"cik"\s*:\s*(\d+)/)?.[1]);
  const name = source.match(/"entityName"\s*:\s*("(?:\\.|[^"\\])*")/)?.[1];
  const doc: FactsDocument = { cik, entityName: name ? JSON.parse(name) : "", facts: {} };
  for (const namespace of ["us-gaap", "ifrs-full"]) {
    const begin = source.indexOf(`"${namespace}"`);
    if (begin < 0) continue;
    const start = source.indexOf("{", begin),
      end = objectEnd(start);
    const concepts: FactsDocument["facts"][string] = {};
    for (const tag of new Set(Object.values(tags).flat())) {
      const property = new RegExp(`"${tag}"\\s*:\\s*\\{`, "g");
      property.lastIndex = start;
      const at = property.exec(source)?.index ?? -1;
      if (at < 0 || at >= end) continue;
      const valueStart = source.indexOf("{", at),
        valueEnd = objectEnd(valueStart);
      if (valueEnd > end || valueEnd - valueStart > 2 * 1024 * 1024)
        throw new Error("Concept exceeds safe bounds.");
      concepts[tag] = JSON.parse(source.slice(valueStart, valueEnd));
    }
    doc.facts[namespace] = concepts;
  }
  if (!cik || !doc.entityName) throw new Error("Invalid Company Facts identity.");
  return doc;
}

/** A statement is an accession + dates + currency, never a mix of latest tags. */
export function extractFactsV2(
  doc: FactsDocument,
  identity: CatalogCompany,
  filings: SecFiling[],
  nativeCurrency?: string
): CompanyV2 {
  if (String(doc.cik).padStart(10, "0") !== identity.cik)
    throw new Error("Company Facts CIK does not match the catalog.");
  const byAccession = new Map(filings.map((f) => [f.accession, f]));
  type Group = {
    start: string;
    end: string;
    currency: string;
    filing: SecFiling;
    values: Partial<FinancialMetrics>;
    sources: PeriodV2["metricSources"];
    year?: number;
    quarter?: number;
  };
  const groups = new Map<string, Group>();
  const calendar = new Map<string, { year: number; quarter?: number }>();
  const today = new Date().toISOString().slice(0, 10);
  for (const [metric, names] of Object.entries(tags) as [keyof FinancialMetrics, string[]][]) {
    const orderedNames =
      metric === "revenue" && identity.sector === "Financials"
        ? ["RevenuesNetOfInterestExpense", "Revenues", "Revenue"]
        : names;
    for (const namespace of ["us-gaap", "ifrs-full"])
      for (const name of orderedNames) {
        const concept = doc.facts[namespace]?.[name];
        if (!concept) continue;
        for (const [currency, facts] of Object.entries(concept.units)) {
          if (!/^[A-Z]{3}$/.test(currency) || (nativeCurrency && currency !== nativeCurrency))
            continue;
          for (const f of facts) {
            const filing = byAccession.get(f.accn);
            if (
              !filing ||
              !/^(10-K|10-Q|20-F)(\/A)?$/.test(filing.form) ||
              !f.start ||
              !Number.isFinite(f.val) ||
              f.filed > today ||
              f.end > f.filed ||
              f.filed !== filing.filedAt
            )
              continue;
            const days = (Date.parse(f.end) - Date.parse(f.start)) / 86400000;
            if (days < 65 || days > 385) continue;
            const key = `${f.accn}:${f.start}:${f.end}:${currency}`;
            let group = groups.get(key);
            if (!group) {
              group = { start: f.start, end: f.end, currency, filing, values: {}, sources: {} };
              groups.set(key, group);
            }
            if (group.values[metric] !== undefined) {
              // Tags are priority ordered. Conflicting copies of the same tag fail closed.
              if (
                group.sources[metric]?.tag === `${namespace}:${name}` &&
                group.values[metric] !== f.val
              )
                throw new Error(`Conflicting ${name} facts in ${filing.accession}.`);
              continue;
            }
            group.values[metric] = f.val;
            group.sources[metric] = {
              // SEC IFRS concepts can have a null human label; the taxonomy tag
              // remains the authoritative identifier, not a missing data value.
              label: concept.label || `${namespace}:${name}`,
              tag: `${namespace}:${name}`,
              accession: f.accn,
              filedAt: f.filed,
              sourceUrl: filing.sourceUrl,
              method: "reported"
            };
            // fy/fp belong to the filing, so use them only for its current report end.
            if (
              f.end === filing.reportDate &&
              Number.isInteger(f.fy) &&
              f.fy! > 1990 &&
              f.fy! <= Number(today.slice(0, 4)) + 1
            ) {
              const quarter = /^Q[123]$/.test(f.fp ?? "")
                ? Number(f.fp!.slice(1))
                : f.fp === "FY"
                  ? 4
                  : undefined;
              calendar.set(f.end, { year: f.fy!, quarter });
            }
          }
        }
      }
  }
  const periods: PeriodV2[] = [];
  const warnings = new Set<string>();
  for (const group of groups.values()) {
    const days = (Date.parse(group.end) - Date.parse(group.start)) / 86400000;
    const kind = days >= 330 ? "annual" : days >= 70 && days <= 105 ? "quarterly" : undefined;
    let fiscal = calendar.get(group.end);
    // Comparative columns have the filing's fy/fp, not their own. Recover the
    // earlier fiscal label only from a known current period in the same filing
    // and a matching annual cycle (including 52/53-week calendars).
    if (!fiscal && kind) {
      const current = calendar.get(group.filing.reportDate);
      const gap = (Date.parse(group.filing.reportDate) - Date.parse(group.end)) / 86400000;
      const years = Math.round(gap / 365.25);
      if (
        current &&
        years >= 1 &&
        years <= 3 &&
        Math.abs(gap - years * 365.25) <= 14 &&
        (kind === "annual" ? current.quarter === 4 : /^(10-Q)(\/A)?$/.test(group.filing.form))
      )
        fiscal = { year: current.year - years, quarter: current.quarter };
    }
    if (!kind || !fiscal || (kind === "quarterly" && !fiscal.quarter)) continue;
    // A 10-Q may report trailing-twelve-month metrics. Duration alone does not
    // make those an annual fiscal statement (Amazon reports such TTM series).
    if (kind === "annual" && fiscal.quarter !== 4) continue;
    if (group.values.revenue === undefined && group.values.netIncome === undefined) continue;
    const period: PeriodV2 = {
      id: kind === "annual" ? `FY${fiscal.year}` : `${fiscal.year}-Q${fiscal.quarter}`,
      label: kind === "annual" ? `FY ${fiscal.year}` : `Q${fiscal.quarter} FY${fiscal.year}`,
      kind,
      fiscalYear: fiscal.year,
      fiscalQuarter: kind === "quarterly" ? (fiscal.quarter as 1 | 2 | 3 | 4) : undefined,
      startDate: group.start,
      endDate: group.end,
      filedAt: group.filing.filedAt,
      accession: group.filing.accession,
      sourceUrl: group.filing.sourceUrl,
      reportingCurrency: group.currency,
      displayCurrency: group.currency,
      derived: false,
      metrics: { ...group.values },
      metricSources: { ...group.sources },
      coverage: { basics: true, segments: false, sankey: false }
    };
    const calc = (
      key: keyof FinancialMetrics,
      a: keyof FinancialMetrics,
      b: keyof FinancialMetrics
    ) => {
      if (
        period.metrics[key] !== undefined ||
        period.metrics[a] === undefined ||
        period.metrics[b] === undefined
      )
        return;
      period.metrics[key] = period.metrics[a]! - period.metrics[b]!;
      period.metricSources[key] = {
        ...period.metricSources[a]!,
        label: key,
        tag: `${a} - ${b}`,
        method: "calculated",
        inputs: [period.metricSources[a]!.sourceUrl, period.metricSources[b]!.sourceUrl]
      };
      period.derived = true;
    };
    calc("grossProfit", "revenue", "costOfRevenue");
    calc("costOfRevenue", "revenue", "grossProfit");
    calc("operatingExpenses", "grossProfit", "operatingIncome");
    const statement = statementPeriod(period);
    period.coverage.sankey =
      identity.sector !== "Financials" && !!statement && buildStatementFlow(statement).ok;
    periods.push(period);
  }
  // Q4 is calculable only when the same accession reports both FY and 9M
  // under the same taxonomy, fiscal start and currency (no cross-filing restatement guess).
  for (const annual of periods.filter((p) => p.kind === "annual")) {
    const nine = [...groups.values()].find(
      (g) =>
        g.filing.accession === annual.accession &&
        g.start === annual.startDate &&
        g.currency === annual.reportingCurrency &&
        (Date.parse(g.end) - Date.parse(g.start)) / 86400000 >= 250 &&
        (Date.parse(g.end) - Date.parse(g.start)) / 86400000 <= 290
    );
    if (!nine) continue;
    const q4: PeriodV2 = {
      ...annual,
      id: `${annual.fiscalYear}-Q4`,
      label: `Q4 FY${annual.fiscalYear}`,
      kind: "quarterly",
      fiscalQuarter: 4,
      startDate: new Date(Date.parse(nine.end) + 86400000).toISOString().slice(0, 10),
      metrics: {},
      metricSources: {},
      derived: true,
      coverage: { basics: true, segments: false, sankey: false }
    };
    for (const key of Object.keys(annual.metrics) as (keyof FinancialMetrics)[]) {
      if (
        nine.values[key] === undefined ||
        annual.metricSources[key]?.tag !== nine.sources[key]?.tag
      )
        continue;
      q4.metrics[key] = annual.metrics[key]! - nine.values[key]!;
      q4.metricSources[key] = {
        ...annual.metricSources[key]!,
        method: "calculated",
        inputs: [
          `FY ${annual.startDate}–${annual.endDate}: ${annual.sourceUrl}`,
          `9M ${nine.start}–${nine.end}: ${nine.filing.sourceUrl}`
        ]
      };
    }
    if (q4.metrics.revenue !== undefined || q4.metrics.netIncome !== undefined) periods.push(q4);
  }
  const selected = new Map<string, PeriodV2>();
  for (const p of periods) {
    const m = p.metrics;
    const tolerance = roundingTolerance(m.revenue ?? m.netIncome ?? 1);
    if (
      (m.revenue !== undefined &&
        m.costOfRevenue !== undefined &&
        m.grossProfit !== undefined &&
        Math.abs(m.revenue - m.costOfRevenue - m.grossProfit) > tolerance) ||
      (m.grossProfit !== undefined &&
        m.operatingExpenses !== undefined &&
        m.operatingIncome !== undefined &&
        Math.abs(m.grossProfit - m.operatingExpenses - m.operatingIncome) > tolerance)
    ) {
      // Some filings include separate realization/reclassification adjustments.
      // Do not erase them by forcing a balance or let one old period block others.
      warnings.add(
        `${p.label}: basic facts require additional accounting adjustments; this candidate period was excluded and any prior validated version is retained.`
      );
      continue;
    }
    const old = selected.get(p.id);
    if (
      !old ||
      old.filedAt < p.filedAt ||
      (old.filedAt === p.filedAt && Object.keys(old.metrics).length < Object.keys(p.metrics).length)
    )
      selected.set(p.id, p);
  }
  const history = [...selected.values()].sort((a, b) => a.endDate.localeCompare(b.endDate));
  if (!history.length)
    throw new Error(
      "No supported, source-linked monetary periods were found. Saved data is unchanged."
    );
  const annual = history.filter((p) => p.kind === "annual").slice(-10);
  const quarterly = history.filter((p) => p.kind === "quarterly").slice(-20);
  if (annual.length < 10 || quarterly.length < 20)
    warnings.add(
      "History is source-available, not necessarily continuous; missing quarters and shorter reporting histories are not estimated."
    );
  warnings.add(
    "Business-category data requires a reviewed filing adapter. Basic metrics can have different reporting scopes; missing metrics are not zero."
  );
  const company: CompanyV2 = {
    schemaVersion: 2,
    ticker: identity.ticker,
    name: identity.name,
    cik: identity.cik,
    accent: "#337d9f",
    reportingCurrency: history.at(-1)!.reportingCurrency,
    latestPeriod: history.at(-1)!.label,
    dataStatus: "verified",
    version: "pending",
    updatedAt: new Date().toISOString(),
    annual,
    quarterly,
    warnings: [...warnings]
  };
  validateV2(company);
  return company;
}

/** Preserve native values while applying one observed period-average FX rate. */
export function convertBasicTwd(period: PeriodV2, rate: number, sourceUrl: string): PeriodV2 {
  if (period.displayCurrency !== "TWD" || !Number.isFinite(rate) || rate <= 0)
    throw new Error("Invalid native currency or period-average FX rate.");
  const next: PeriodV2 = {
    ...period,
    displayCurrency: "USD",
    derived: true,
    metrics: {},
    metricSources: {},
    fx: {
      rate,
      unit: "TWD per USD",
      sourceUrl,
      startDate: period.startDate,
      endDate: period.endDate
    },
    coverage: { ...period.coverage, sankey: false }
  };
  for (const key of Object.keys(period.metrics) as (keyof FinancialMetrics)[]) {
    const value = period.metrics[key];
    if (value === undefined) continue;
    next.metrics[key] = value / rate;
    next.metricSources[key] = {
      ...period.metricSources[key]!,
      method: "calculated",
      inputs: [
        ...(period.metricSources[key]?.inputs ?? []),
        `Native TWD ${value}; period-average TWD/USD ${rate}: ${sourceUrl}`
      ]
    };
  }
  const statement = statementPeriod(next);
  next.coverage.sankey = !!statement && buildStatementFlow(statement).ok;
  return next;
}
