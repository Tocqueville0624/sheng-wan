import { XMLParser } from "fast-xml-parser";
import type { CompanyConfig } from "./companies";
import type { FilingAdapter, SegmentRule } from "./adapters";
import type {
  FinancialMetrics,
  FinancialPeriod,
  RevenueSegment
} from "../../src/features/finance/types";
import { validatePeriod } from "./validate";

type XmlNode = Record<string, unknown>;
export type XbrlContext = {
  id: string;
  cik: string;
  start?: string;
  end?: string;
  dimensions: Record<string, string>;
  typed: boolean;
};
export type XbrlFact = {
  tag: string;
  context: XbrlContext;
  currency: string;
  value: number;
  decimals: number;
};
export type ParsedFiling = {
  facts: XbrlFact[];
  fiscalYear: number;
  fiscalPeriod: string;
  periodEnd: string;
};

function text(node: unknown): string {
  if (node == null) return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return Object.entries(node as XmlNode)
    .filter(([key]) => !key.startsWith("@"))
    .map(([, value]) => text(value))
    .join("");
}

function walk(node: unknown, visit: (name: string, item: XmlNode) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, visit));
    return;
  }
  for (const [name, value] of Object.entries(node)) {
    if (name.startsWith("@") || name === "#text") continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item && typeof item === "object") visit(name, item as XmlNode);
      walk(item, visit);
    }
  }
}

function descendants(node: unknown, name: string): XmlNode[] {
  const found: XmlNode[] = [];
  walk(node, (tag, value) => {
    if (tag.split(":").at(-1) === name) found.push(value);
  });
  return found;
}

function findText(node: unknown, name: string): string {
  let found = "";
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key.split(":").at(-1) === name) found ||= text(child);
      else if (!key.startsWith("@")) visit(child);
    }
  };
  visit(node);
  return found;
}

function numericValue(node: XmlNode): number | undefined {
  if (node["@xsi:nil"] === "true") return undefined;
  // Mixed child markup needs an order-preserving transformation adapter; never
  // concatenate grouped XML object keys into a potentially different number.
  if (Object.keys(node).some((key) => !key.startsWith("@") && key !== "#text")) return undefined;
  const format = String(node["@format"] ?? "").toLowerCase();
  if (format && !/(num|zero|fixed-zero)/.test(format)) return undefined;
  let raw = text(node)
    .replace(/&(?:nbsp|#160|#xa0);/gi, "")
    .replace(/[\s$€£]/g, "");
  if (/^(?:—|–|-|&#8212;|&#x2014;)$/.test(raw) || /zero|numdash/.test(format)) raw = "0";
  if (/num-comma-decimal|numcommadecimal/.test(format))
    raw = raw.replaceAll(".", "").replace(",", ".");
  else raw = raw.replaceAll(",", "");
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return undefined;
  const scale = Number(node["@scale"] ?? 0);
  const value = Number(raw) * 10 ** scale * (node["@sign"] === "-" ? -1 : 1);
  return Number.isFinite(value) ? value : undefined;
}

export function parseInlineXbrl(html: string): ParsedFiling {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    processEntities: false
  });
  const contexts = new Map<string, XbrlContext>();
  const units = new Map<string, string>();
  const numbers: XmlNode[] = [];
  const metadata = new Map<string, string>();
  const visit = (name: string, node: XmlNode) => {
    const local = name.split(":").at(-1);
    if (local === "context") {
      const dimensions: Record<string, string> = {};
      for (const member of descendants(node, "explicitMember"))
        dimensions[String(member["@dimension"])] = text(member);
      const id = String(node["@id"]);
      contexts.set(id, {
        id,
        cik: findText(node, "identifier"),
        start: findText(node, "startDate") || undefined,
        end: findText(node, "endDate") || findText(node, "instant") || undefined,
        dimensions,
        typed: descendants(node, "typedMember").length > 0
      });
    } else if (local === "unit") {
      const measure = findText(node, "measure");
      if (!descendants(node, "divide").length && /^(?:iso4217:)?(?:USD|TWD)$/.test(measure))
        units.set(String(node["@id"]), measure.split(":").at(-1)!);
    } else if (local === "nonFraction") numbers.push(node);
    else if (local === "nonNumeric") metadata.set(String(node["@name"]), text(node));
  };
  // Parse only financial fragments, never an entire multi-megabyte filing DOM.
  // Each fragment is bounded; all existing precision/dimension checks still apply.
  const openings = /<((?:[\w.-]+:)?(?:context|unit|nonFraction|nonNumeric))\b[^>]*>/g;
  let count = 0;
  for (let match = openings.exec(html); match; match = openings.exec(html)) {
    const [opening, tag] = match;
    if (
      tag.endsWith("nonNumeric") &&
      !/name=["']dei:Document(?:FiscalYearFocus|FiscalPeriodFocus|PeriodEndDate)["']/.test(opening)
    )
      continue;
    if (/\/\s*>$/.test(opening)) {
      walk(parser.parse(opening) as XmlNode, visit);
      continue;
    }
    // Inline tags can nest (Apple nests FiscalYearEndDate inside PeriodEndDate).
    // A lazy closing-tag regex truncates the year and silently invents a date.
    const tags = new RegExp(`<\\/?${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^>]*>`, "g");
    tags.lastIndex = openings.lastIndex;
    let depth = 1,
      end = openings.lastIndex;
    for (let token = tags.exec(html); token; token = tags.exec(html)) {
      if (token.index - match.index > 262144) break;
      if (token[0].startsWith("</")) depth--;
      else if (!/\/\s*>$/.test(token[0])) depth++;
      if (!depth) {
        end = tags.lastIndex;
        break;
      }
    }
    if (depth || end - match.index > 262144 || ++count > 100000)
      throw new Error("Inline XBRL exceeds safe extraction bounds.");
    const fragment = html.slice(match.index, end);
    walk(parser.parse(fragment) as XmlNode, visit);
    if (tag.endsWith("nonNumeric")) {
      const name = opening.match(/\bname=["']([^"']+)["']/)?.[1];
      if (name) metadata.set(name, fragment.replace(/<[^>]+>/g, ""));
    }
    openings.lastIndex = end;
  }
  const facts: XbrlFact[] = [];
  for (const node of numbers) {
    const context = contexts.get(String(node["@contextRef"]));
    const currency = units.get(String(node["@unitRef"]));
    const value = numericValue(node);
    if (context && currency && value !== undefined)
      facts.push({
        tag: String(node["@name"]),
        context,
        currency,
        value,
        decimals: node["@decimals"] === "INF" ? Infinity : Number(node["@decimals"] ?? -99)
      });
  }
  if (!facts.length) throw new Error("No monetary inline-XBRL facts were found in the SEC filing.");
  const rawEnd = (metadata.get("dei:DocumentPeriodEndDate") ?? "").replace(
    /&(?:nbsp|#160|#xa0);/gi,
    " "
  );
  const parsedEnd = Date.parse(rawEnd);
  return {
    facts,
    fiscalYear: Number(metadata.get("dei:DocumentFiscalYearFocus")),
    fiscalPeriod: metadata.get("dei:DocumentFiscalPeriodFocus") ?? "FY",
    periodEnd: Number.isFinite(parsedEnd) ? new Date(parsedEnd).toISOString().slice(0, 10) : ""
  };
}

const metricTags: Record<keyof FinancialMetrics, string[]> = {
  revenue: [
    "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    "us-gaap:Revenues",
    "us-gaap:SalesRevenueNet",
    "ifrs-full:Revenue"
  ],
  costOfRevenue: [
    "us-gaap:CostOfRevenue",
    "us-gaap:CostOfGoodsAndServicesSold",
    "us-gaap:CostOfSales",
    "ifrs-full:CostOfSales"
  ],
  grossProfit: ["us-gaap:GrossProfit", "ifrs-full:GrossProfit"],
  operatingExpenses: ["us-gaap:OperatingExpenses", "ifrs-full:OperatingExpense"],
  operatingIncome: ["us-gaap:OperatingIncomeLoss", "ifrs-full:ProfitLossFromOperatingActivities"],
  pretaxIncome: [
    "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    "ifrs-full:ProfitLossBeforeTax"
  ],
  incomeTax: [
    "us-gaap:IncomeTaxExpenseBenefit",
    "ifrs-full:IncomeTaxExpenseContinuingOperations",
    "ifrs-full:IncomeTaxExpense"
  ],
  netIncome: ["us-gaap:NetIncomeLoss", "us-gaap:ProfitLoss", "ifrs-full:ProfitLoss"],
  researchAndDevelopment: [
    "us-gaap:ResearchAndDevelopmentExpense",
    "us-gaap:ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost",
    "ifrs-full:ResearchAndDevelopmentExpense"
  ],
  sellingGeneralAndAdministrative: ["us-gaap:SellingGeneralAndAdministrativeExpense"],
  equityMethodIncome: ["us-gaap:IncomeLossFromEquityMethodInvestments"]
};

function exactValue(facts: XbrlFact[], tags: string[], dimensions: Record<string, string> = {}) {
  for (const tag of tags) {
    const matches = facts.filter(
      (fact) =>
        fact.tag === tag &&
        !fact.context.typed &&
        Object.keys(fact.context.dimensions).length === Object.keys(dimensions).length &&
        Object.entries(dimensions).every(
          ([axis, member]) => fact.context.dimensions[axis] === member
        )
    );
    if (!matches.length) continue;
    // Narrative repeats can be rounded to billions while the statement is in millions.
    // Use the highest declared XBRL precision, never a first-occurrence heuristic.
    const precision = Math.max(...matches.map((fact) => fact.decimals));
    const precise = matches.filter((fact) => fact.decimals === precision);
    const values = new Set(precise.map((fact) => fact.value));
    if (values.size !== 1) throw new Error(`Conflicting same-context ${tag} values in the filing.`);
    return precise[0].value;
  }
  return undefined;
}

function categories(facts: XbrlFact[], rules: SegmentRule[]) {
  const result: RevenueSegment[] = [];
  for (const rule of rules) {
    const alternatives = [rule, ...(rule.alternatives ?? [])]
      .map((candidate) => exactValue(facts, [candidate.tag], candidate.dimensions))
      .filter((value) => value !== undefined);
    if (new Set(alternatives).size > 1)
      throw new Error(`Conflicting reviewed taxonomy aliases for ${rule.id}.`);
    const revenue = alternatives[0];
    if (revenue === undefined) return undefined;
    result.push({ id: rule.id, label: rule.label, revenue });
  }
  return result;
}

export function extractInlinePeriods(
  parsed: ParsedFiling,
  company: CompanyConfig,
  adapter: FilingAdapter,
  sourceUrl: string,
  filedAt: string
): FinancialPeriod[] {
  const facts = parsed.facts.filter(
    (fact) =>
      fact.currency === company.reportingCurrency &&
      Number(fact.context.cik) === Number(company.cik)
  );
  const durations = new Map<string, { start: string; end: string }>();
  for (const fact of facts) {
    const { start, end } = fact.context;
    if (start && end && start < end) durations.set(`${start}:${end}`, { start, end });
  }
  const periods: FinancialPeriod[] = [];
  for (const { start, end } of durations.values()) {
    const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
    const kind =
      days >= 330 && days <= 385 ? "annual" : days >= 70 && days <= 105 ? "quarterly" : undefined;
    if (!kind) continue;
    const inPeriod = facts.filter(
      (fact) => fact.context.start === start && fact.context.end === end
    );
    const get = (key: keyof FinancialMetrics) =>
      exactValue(inPeriod, adapter.metricTags?.[key] ?? metricTags[key]);
    const revenue = get("revenue");
    const operatingIncome = get("operatingIncome");
    const pretaxIncome = get("pretaxIncome");
    const incomeTax = get("incomeTax");
    const netIncome = get("netIncome");
    if (
      [revenue, operatingIncome, pretaxIncome, incomeTax, netIncome].some(
        (value) => value === undefined
      )
    )
      continue;
    const reportedCost = get("costOfRevenue");
    const reportedGross = get("grossProfit");
    const costOfRevenue =
      reportedCost ?? (reportedGross === undefined ? undefined : revenue! - reportedGross);
    const grossProfit =
      reportedGross ?? (costOfRevenue === undefined ? undefined : revenue! - costOfRevenue);
    if (costOfRevenue === undefined || grossProfit === undefined) continue;
    let segments = categories(inPeriod, adapter.segments);
    let segmentBasis = adapter.segmentBasis;
    if (!segments)
      for (const alternative of adapter.segmentAlternatives ?? []) {
        segments = categories(inPeriod, alternative.segments);
        if (segments) {
          segmentBasis = alternative.segmentBasis;
          break;
        }
      }
    if (!segments) continue;
    const revenueAdjustments = adapter.adjustments?.length
      ? categories(inPeriod, adapter.adjustments)
      : undefined;
    if (adapter.adjustments?.length && !revenueAdjustments) continue;
    const operatingExpenseDetails = adapter.operatingExpenseDetails?.map((rule) => {
      const amount = exactValue(inPeriod, [rule.tag], rule.dimensions);
      return amount === undefined
        ? undefined
        : { id: rule.id, label: rule.label, amount: amount * (rule.multiplier ?? 1) };
    });
    const fiscalYear =
      Number.isFinite(parsed.fiscalYear) && parsed.periodEnd
        ? parsed.fiscalYear - (Number(parsed.periodEnd.slice(0, 4)) - Number(end.slice(0, 4)))
        : Number(end.slice(0, 4));
    const currentQuarter = /^Q[1-4]$/.test(parsed.fiscalPeriod)
      ? Number(parsed.fiscalPeriod.slice(1))
      : 4;
    const quarterDistance = parsed.periodEnd
      ? Math.round((Date.parse(parsed.periodEnd) - Date.parse(end)) / (91.3125 * 86_400_000))
      : 0;
    const quarter = (((((currentQuarter - 1 - quarterDistance) % 4) + 4) % 4) + 1) as 1 | 2 | 3 | 4;
    const period: FinancialPeriod = {
      id: kind === "annual" ? `FY${fiscalYear}` : `${fiscalYear}-Q${quarter}`,
      label: kind === "annual" ? `FY ${fiscalYear}` : `Q${quarter} FY${fiscalYear}`,
      kind,
      fiscalYear,
      fiscalQuarter: kind === "quarterly" ? quarter : undefined,
      startDate: start,
      endDate: end,
      filedAt,
      sourceUrl,
      reportingCurrency: company.reportingCurrency,
      displayCurrency: "USD",
      derived: reportedCost === undefined || reportedGross === undefined,
      metrics: {
        revenue: revenue!,
        costOfRevenue,
        grossProfit,
        operatingExpenses: grossProfit - operatingIncome!,
        operatingIncome: operatingIncome!,
        pretaxIncome: pretaxIncome!,
        incomeTax: incomeTax!,
        netIncome: netIncome!,
        researchAndDevelopment: get("researchAndDevelopment"),
        sellingGeneralAndAdministrative: get("sellingGeneralAndAdministrative"),
        equityMethodIncome: company.ticker === "AMZN" ? get("equityMethodIncome") : undefined
      },
      segments,
      revenueAdjustments,
      operatingExpenseDetails: operatingExpenseDetails?.every((item) => item !== undefined)
        ? operatingExpenseDetails
        : undefined,
      segmentSourceUrl: sourceUrl,
      segmentBasis
    };
    validatePeriod(period);
    periods.push(period);
  }
  return periods.sort((a, b) => a.endDate.localeCompare(b.endDate));
}
