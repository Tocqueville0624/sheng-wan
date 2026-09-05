import type { CompanyConfig } from "./companies";
import type {
  FinancialMetrics,
  FinancialPeriod,
  PeriodKind
} from "../../src/features/finance/types";
import { validatePeriod } from "./validate";
export { isReconciled } from "./validate";

type SecUnit = {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy?: number;
  fp?: string;
  form: string;
  filed: string;
  frame?: string;
};

export type CompanyFacts = {
  entityName: string;
  facts: Record<string, Record<string, { label: string; units: Record<string, SecUnit[]> }>>;
};

const TAGS = {
  revenue: [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
    "Revenue"
  ],
  costOfRevenue: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfSales"],
  grossProfit: ["GrossProfit"],
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
  researchAndDevelopment: [
    "ResearchAndDevelopmentExpense",
    "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"
  ],
  sellingGeneralAndAdministrative: ["SellingGeneralAndAdministrativeExpense"],
  equityMethodIncome: ["IncomeLossFromEquityMethodInvestments"]
} satisfies Record<keyof Omit<FinancialMetrics, "operatingExpenses">, string[]>;

const forms = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A", "6-K"]);

function durationDays(fact: SecUnit) {
  if (!fact.start) return 0;
  return Math.round((Date.parse(fact.end) - Date.parse(fact.start)) / 86_400_000);
}

function candidates(facts: CompanyFacts, taxonomy: string, tags: string[], currency: string) {
  const namespace = facts.facts[taxonomy] ?? {};
  return tags.flatMap((tag) => {
    const units = namespace[tag]?.units;
    const values = units?.[currency];
    return values
      ? values.filter((item) => forms.has(item.form) && item.start && Number.isFinite(item.val))
      : [];
  });
}

function pickForPeriod(values: SecUnit[], startDate: string, endDate: string) {
  return values
    .filter((item) => item.start === startDate && item.end === endDate)
    .sort((a, b) => b.filed.localeCompare(a.filed))[0];
}

function periodKind(fact: SecUnit): PeriodKind | undefined {
  const days = durationDays(fact);
  if (days >= 330 && days <= 385) return "annual";
  if (days >= 70 && days <= 105) return "quarterly";
  return undefined;
}

function fiscalPeriod(endDate: string, company: CompanyConfig) {
  // SEC fy/fp describe the filing, not necessarily a comparative fact's own period.
  // A 52/53-week statement ending within the first week belongs to the prior month.
  const date = new Date(`${endDate}T00:00:00Z`);
  if (date.getUTCDate() <= 7) date.setUTCDate(0);
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear() + (month > company.fiscalYearEndMonth ? 1 : 0);
  const offset = (month - company.fiscalYearEndMonth + 11) % 12;
  const quarter = (Math.floor(offset / 3) + 1) as 1 | 2 | 3 | 4;
  return { year, quarter };
}

function metricValue(
  facts: CompanyFacts,
  company: CompanyConfig,
  key: keyof Omit<FinancialMetrics, "operatingExpenses">,
  anchor: SecUnit
) {
  return pickForPeriod(
    candidates(facts, company.taxonomy, TAGS[key], company.reportingCurrency),
    anchor.start!,
    anchor.end
  )?.val;
}

export function extractPeriods(facts: CompanyFacts, company: CompanyConfig): FinancialPeriod[] {
  const revenues = candidates(facts, company.taxonomy, TAGS.revenue, company.reportingCurrency);
  const unique = new Map<string, SecUnit>();
  for (const fact of revenues) {
    const kind = periodKind(fact);
    if (!kind) continue;
    const key = `${kind}:${fact.start}:${fact.end}`;
    const prior = unique.get(key);
    if (!prior || prior.filed < fact.filed) unique.set(key, fact);
  }

  const periods: FinancialPeriod[] = [];
  for (const anchor of [...unique.values()].sort((a, b) => a.end.localeCompare(b.end))) {
    const kind = periodKind(anchor)!;
    const revenue = anchor.val;
    const gross = metricValue(facts, company, "grossProfit", anchor);
    const cost = metricValue(facts, company, "costOfRevenue", anchor);
    const operatingIncome = metricValue(facts, company, "operatingIncome", anchor);
    const pretaxIncome = metricValue(facts, company, "pretaxIncome", anchor);
    const incomeTax = metricValue(facts, company, "incomeTax", anchor);
    const netIncome = metricValue(facts, company, "netIncome", anchor);
    if (
      [revenue, operatingIncome, pretaxIncome, incomeTax, netIncome].some(
        (value) => value === undefined
      )
    )
      continue;
    const grossProfit = gross ?? (cost === undefined ? undefined : revenue - cost);
    const costOfRevenue = cost ?? (grossProfit === undefined ? undefined : revenue - grossProfit);
    if (grossProfit === undefined || costOfRevenue === undefined) continue;
    const operatingExpenses = grossProfit - operatingIncome!;
    const fiscal = fiscalPeriod(anchor.end, company);
    const year = kind === "annual" ? Number(anchor.end.slice(0, 4)) : fiscal.year;
    const quarter = kind === "quarterly" ? fiscal.quarter : undefined;
    const period: FinancialPeriod = {
      id: kind === "annual" ? `FY${year}` : `${year}-Q${quarter ?? "?"}`,
      label: kind === "annual" ? `FY ${year}` : `Q${quarter ?? "?"} FY${year}`,
      kind,
      fiscalYear: year,
      fiscalQuarter: quarter,
      startDate: anchor.start!,
      endDate: anchor.end,
      filedAt: anchor.filed,
      accession: anchor.accn,
      sourceUrl: `https://www.sec.gov/Archives/edgar/data/${Number(company.cik)}/${anchor.accn.replaceAll("-", "")}/`,
      reportingCurrency: company.reportingCurrency,
      displayCurrency: "USD",
      derived: gross === undefined || cost === undefined,
      metrics: {
        revenue,
        costOfRevenue,
        grossProfit,
        operatingExpenses,
        operatingIncome: operatingIncome!,
        pretaxIncome: pretaxIncome!,
        incomeTax: incomeTax!,
        netIncome: netIncome!,
        researchAndDevelopment: metricValue(facts, company, "researchAndDevelopment", anchor),
        sellingGeneralAndAdministrative: metricValue(
          facts,
          company,
          "sellingGeneralAndAdministrative",
          anchor
        ),
        equityMethodIncome: metricValue(facts, company, "equityMethodIncome", anchor)
      }
    };
    validatePeriod(period);
    periods.push(period);
  }
  return periods;
}

export function convertPeriodToUsd(
  period: FinancialPeriod,
  rate: number,
  sourceUrl: string
): FinancialPeriod {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("FX rate must be finite and positive.");
  const divide = (value: number | undefined) => (value === undefined ? undefined : value / rate);
  return {
    ...period,
    fx: {
      rate,
      unit: "TWD per USD",
      sourceUrl,
      startDate: period.startDate,
      endDate: period.endDate
    },
    metrics: Object.fromEntries(
      Object.entries(period.metrics).map(([key, value]) => [key, divide(value)])
    ) as FinancialMetrics,
    segments: period.segments?.map((segment) => ({ ...segment, revenue: segment.revenue / rate })),
    revenueAdjustments: period.revenueAdjustments?.map((adjustment) => ({
      ...adjustment,
      revenue: adjustment.revenue / rate
    })),
    grossProfitAdjustments: period.grossProfitAdjustments?.map((adjustment) => ({
      ...adjustment,
      amount: adjustment.amount / rate
    })),
    operatingExpenseDetails: period.operatingExpenseDetails?.map((item) => ({
      ...item,
      amount: item.amount / rate
    }))
  };
}
