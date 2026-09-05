import type { FinancialMetrics, FinancialPeriod } from "../../src/features/finance/types";
import { filingAdapters } from "./adapters";
import { validatePeriod } from "./validate";

type Table = { rows: string[][]; text: string };

function textContent(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) =>
      String.fromCodePoint(
        code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code)
      )
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tables(html: string): Table[] {
  return (html.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) ?? []).map((table) => ({
    rows: (table.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []).map((row) =>
      (row.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map(textContent).filter(Boolean)
    ),
    text: textContent(table)
  }));
}

function exactlyOne<T>(values: T[], name: string): T {
  if (values.length !== 1)
    throw new Error(`TSM: expected exactly one ${name}; found ${values.length}.`);
  return values[0];
}

function rowNumbers(table: Table, label: RegExp, expected: number): number[] {
  const row = exactlyOne(
    table.rows.filter((candidate) => label.test(candidate[0] ?? "")),
    String(label)
  );
  // Currency symbols and accounting parentheses can occupy separate HTML cells.
  const raw = row.slice(1).join(" ").replace(/\$/g, "").trim();
  const pattern = /\(\s*\d[\d,]*(?:\.\d+)?\s*\)|-?\d[\d,]*(?:\.\d+)?|[—–-]/g;
  const tokens = raw.match(pattern) ?? [];
  if (raw.replace(pattern, "").trim() || tokens.length !== expected)
    throw new Error(`TSM: unexpected numeric columns for ${row[0]}.`);
  return tokens.map((token) => {
    if (/^[—–-]$/.test(token)) return 0;
    const magnitude = Number(token.replace(/[(),\s]/g, ""));
    const value = token.startsWith("(") ? -magnitude : magnitude;
    if (!Number.isFinite(value)) throw new Error(`TSM: invalid numeric value for ${row[0]}.`);
    return value;
  });
}

function header(table: Table) {
  const quarter = table.text.match(
    /Three Months Ended (March 31|June 30|September 30|December 31)/i
  )?.[1];
  const ends: Record<string, { monthDay: string; quarter: 1 | 2 | 3 | 4; start: string }> = {
    "march 31": { monthDay: "03-31", quarter: 1, start: "01-01" },
    "june 30": { monthDay: "06-30", quarter: 2, start: "04-01" },
    "september 30": { monthDay: "09-30", quarter: 3, start: "07-01" },
    "december 31": { monthDay: "12-31", quarter: 4, start: "10-01" }
  };
  if (!quarter)
    throw new Error("TSM: the statement does not identify a three-month reporting period.");
  const years = exactlyOne(
    table.rows.filter((row) => {
      const cells = row[0] === "Platform" ? row.slice(1) : row;
      return cells.length >= 2 && cells.every((cell) => /^20\d{2}$/.test(cell));
    }),
    "year header"
  )
    .filter((cell) => cell !== "Platform")
    .map(Number);
  if (
    ![2, 4].includes(years.length) ||
    years[0] !== years[1] + 1 ||
    (years.length === 4 && (years[0] !== years[2] || years[1] !== years[3]))
  )
    throw new Error("TSM: unrecognized current/comparative year columns.");
  return { ...ends[quarter.toLowerCase()], years };
}

/**
 * TSM furnishes its quarterly Taiwan-IFRS statements as an untagged HTML exhibit.
 * Read the explicitly labeled statement and platform tables, never percentages
 * from an earnings presentation. Values remain native TWD until the FX stage.
 */
export function extractTsmHtml(
  html: string,
  sourceUrl: string,
  filedAt: string
): FinancialPeriod[] {
  const documentText = textContent(html);
  if (
    !/Taiwan Semiconductor Manufacturing Company Limited and Subsidiaries/i.test(documentText) ||
    !/CONSOLIDATED STATEMENTS OF COMPREHENSIVE INCOME\s*\(In Thousands of New Taiwan Dollars, Except Earnings Per Share\)/i.test(
      documentText
    )
  )
    throw new Error(
      "TSM: issuer, consolidated statement, or native TWD unit could not be verified."
    );
  const allTables = tables(html);
  const statement = exactlyOne(
    allTables.filter(
      (table) =>
        table.rows.some((row) => /^NET REVENUE(?:\s|$)/.test(row[0] ?? "")) &&
        table.rows.some((row) => /^INCOME BEFORE INCOME TAX$/.test(row[0] ?? ""))
    ),
    "income statement table"
  );
  const platform = exactlyOne(
    allTables.filter(
      (table) =>
        table.rows.some((row) => /^High Performance Computing$/i.test(row[0] ?? "")) &&
        table.rows.some((row) => /^Smartphone$/i.test(row[0] ?? ""))
    ),
    "platform revenue table"
  );
  const dates = header(statement);
  const platformDates = header(platform);
  if (dates.quarter !== platformDates.quarter || dates.years.join() !== platformDates.years.join())
    throw new Error("TSM: income statement and platform table periods differ.");
  const metricRows: Record<
    | "revenue"
    | "costOfRevenue"
    | "grossProfit"
    | "operatingIncome"
    | "pretaxIncome"
    | "incomeTax"
    | "netIncome"
    | "researchAndDevelopment",
    RegExp
  > = {
    revenue: /^NET REVENUE(?:\s|$)/,
    costOfRevenue: /^COST OF REVENUE(?:\s|$)/,
    grossProfit: /^GROSS PROFIT$/,
    operatingIncome: /^INCOME FROM OPERATIONS(?:\s|$)/,
    pretaxIncome: /^INCOME BEFORE INCOME TAX$/,
    incomeTax: /^INCOME TAX EXPENSE(?:\s|$)/,
    netIncome: /^NET INCOME$/,
    researchAndDevelopment: /^Research and development$/i
  };
  const metrics = Object.fromEntries(
    Object.entries(metricRows).map(([metric, row]) => [
      metric,
      rowNumbers(statement, row, dates.years.length * 2)
    ])
  ) as Record<keyof typeof metricRows, number[]>;
  const platformLabels = [
    /^High Performance Computing$/i,
    /^Smartphone$/i,
    /^Internet of Things$/i,
    /^Automotive$/i,
    /^Digital Consumer Electronics$/i,
    /^Others?$/i
  ];
  const platformValues = platformLabels.map((label) =>
    rowNumbers(platform, label, dates.years.length)
  );
  // Only the first two explicitly reported three-month columns are used. The
  // remaining columns are year-to-date and must not masquerade as quarters.
  return dates.years
    .slice(0, 2)
    .map((year, index) => {
      const amounts = Object.fromEntries(
        Object.entries(metrics).map(([key, values]) => [key, values[index * 2] * 1_000])
      ) as Omit<FinancialMetrics, "operatingExpenses">;
      const period: FinancialPeriod = {
        id: `${year}-Q${dates.quarter}`,
        label: `Q${dates.quarter} FY${year}`,
        kind: "quarterly",
        fiscalYear: year,
        fiscalQuarter: dates.quarter,
        startDate: `${year}-${dates.start}`,
        endDate: `${year}-${dates.monthDay}`,
        filedAt,
        sourceUrl,
        reportingCurrency: "TWD",
        displayCurrency: "USD",
        derived: true,
        metrics: {
          ...amounts,
          // Includes the reported other operating income/expense offset. SG&A
          // cannot be inserted as if this were the unadjusted expense subtotal.
          operatingExpenses: amounts.grossProfit - amounts.operatingIncome
        },
        segments: filingAdapters.TSM.segments.map((rule, i) => ({
          id: rule.id,
          label: rule.label,
          revenue: platformValues[i][index] * 1_000
        })),
        segmentSourceUrl: sourceUrl,
        segmentBasis: filingAdapters.TSM.segmentBasis
      };
      validatePeriod(period);
      return period;
    })
    .sort((a, b) => a.endDate.localeCompare(b.endDate));
}
