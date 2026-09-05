import type { FinancialMetrics, FinancialPeriod } from "../../src/features/finance/types";
import { filingAdapters } from "./adapters";
import { validatePeriod } from "./validate";
import type { SecFiling } from "./sec-shared";

type Table = { rows: string[][]; text: string; before: string };

function textContent(html: string): string {
  return html
    .replace(/<\/?(?:span|font|a|b|i|strong|em|u)\b[^>]*>/gi, "")
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
  return [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map((match) => ({
    rows: (match[0].match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []).map((row) =>
      (row.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map(textContent).filter(Boolean)
    ),
    text: textContent(match[0]),
    before: textContent(html.slice(Math.max(0, match.index! - 4000), match.index))
  }));
}

function exactlyOne<T>(values: T[], name: string): T {
  if (values.length !== 1)
    throw new Error(`TSM: expected exactly one ${name}; found ${values.length}.`);
  return values[0];
}

function rowNumbers(table: Table, label: RegExp, expected: number, notes = false): number[] {
  const row = exactlyOne(
    table.rows.filter((candidate) => label.test(candidate[0] ?? "")),
    String(label)
  );
  // Currency symbols and accounting parentheses can occupy separate HTML cells.
  const cells = row.slice(1);
  if (notes && /^\d{1,2}(?:,\s*\d{1,2})*$/.test(cells[0] ?? "")) cells.shift();
  const raw = cells.join(" ").replace(/\$/g, "").trim();
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

/** Read the described exhibit, not a guessed filename or an earnings slide. */
export function tsmQuarterlyExhibit(html: string, filing: SecFiling) {
  const candidates = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].flatMap(([row]) => {
    const text = textContent(row);
    if (!/Consolidated Financial Statements/i.test(text) || /Unconsolidated|Standalone/i.test(text))
      return [];
    const date = text.match(/(?:March 31|June 30|September 30),?\s+20\d{2}/i)?.[0];
    if (!date) return [];
    const year = date.match(/20\d{2}/)![0];
    const end = `${year}-${/^March/i.test(date) ? "03-31" : /^June/i.test(date) ? "06-30" : "09-30"}`;
    const links = [...new Set([...row.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]))];
    const name = links.filter((name) => /^[\w.-]+\.html?$/i.test(name) && !name.includes(".."));
    if (name.length !== 1 || end > filing.filedAt) return [];
    return [{ url: filing.directoryUrl + name[0], reportDate: end }];
  });
  if (candidates.length > 1) throw new Error("TSM: ambiguous consolidated financial exhibits.");
  return candidates[0];
}

/** Older 6-K indexes use the filing date as reportDate and opaque exhibit names. */
export function tsmQuarterlyCandidates(filings: SecFiling[]) {
  const modern = filings
    .filter(
      (f) =>
        f.form === "6-K" && /^tsm-fsx/i.test(f.primaryDocument) && !f.reportDate.endsWith("-12-31")
    )
    .slice(0, 20);
  // Filing month is only a discovery filter. The cover's explicit reporting
  // date and the actual three-month statement must both validate before use.
  const legacy = filings
    .filter(
      (f) =>
        f.form === "6-K" &&
        /^tsm-6k_20/i.test(f.primaryDocument) &&
        /^20\d{2}-(05|08|11)-/.test(f.filedAt) &&
        f.filedAt < "2023-03-01"
    )
    .slice(0, 60);
  return [...modern, ...legacy];
}

/** Older audited 20-F statements explicitly report three native-TWD years. */
export function extractTsmAnnualHtml(
  html: string,
  sourceUrl: string,
  filedAt: string
): FinancialPeriod[] {
  const statement = exactlyOne(
    tables(html).filter(
      (table) =>
        table.rows.some((r) => r[0] === "NET REVENUE") &&
        table.rows.some((r) => r[0] === "INCOME BEFORE INCOME TAX")
    ),
    "annual income statement table"
  );
  if (
    !/Taiwan Semiconductor Manufacturing Company Limited and Subsidiaries/i.test(
      statement.before
    ) ||
    !/CONSOLIDATED STATEMENTS OF PROFIT OR LOSS AND OTHER COMPREHENSIVE INCOME/i.test(
      statement.before
    ) ||
    !/In Millions of New Taiwan Dollars or U.S. Dollars/i.test(statement.before)
  )
    throw new Error(
      "TSM: annual issuer, statement scope, or native million-TWD unit could not be verified."
    );
  const years = exactlyOne(
    statement.rows.filter(
      (row) =>
        row[0] === "Notes" && row.length === 4 && row.slice(1).every((c) => /^20\d{2}$/.test(c))
    ),
    "annual year header"
  )
    .slice(1)
    .map(Number);
  if (
    years[1] !== years[0] + 1 ||
    years[2] !== years[1] + 1 ||
    !statement.rows.some((r) => r.join() === "NT$,NT$,NT$,US$")
  )
    throw new Error("TSM: unrecognized native/comparative/convenience-currency columns.");
  const metrics = {
    revenue: rowNumbers(statement, /^NET REVENUE$/, 4, true),
    costOfRevenue: rowNumbers(statement, /^COST OF REVENUE$/, 4, true),
    grossProfit: rowNumbers(statement, /^GROSS PROFIT$/, 4),
    operatingIncome: rowNumbers(statement, /^INCOME FROM OPERATIONS$/, 4, true),
    pretaxIncome: rowNumbers(statement, /^INCOME BEFORE INCOME TAX$/, 4),
    incomeTax: rowNumbers(statement, /^INCOME TAX EXPENSE$/, 4, true),
    netIncome: rowNumbers(statement, /^NET INCOME$/, 4),
    researchAndDevelopment: rowNumbers(statement, /^Research and development$/, 4)
  };
  const adjustmentRows = statement.rows.filter((r) =>
    /^(?:REALIZED|UNREALIZED|\(UNREALIZED\)).*GROSS PROFIT ON SALES TO ASSOCIATES$/.test(r[0] ?? "")
  );
  const adjustments = adjustmentRows.map((row) => ({
    label: row[0],
    values: rowNumbers({ ...statement, rows: [row] }, /./, 4)
  }));
  return years.map((year, i) => {
    const values = Object.fromEntries(
      Object.entries(metrics).map(([key, values]) => [key, values[i] * 1e6])
    ) as Omit<FinancialMetrics, "operatingExpenses">;
    const period: FinancialPeriod = {
      id: `FY${year}`,
      label: `FY ${year}`,
      kind: "annual",
      fiscalYear: year,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      filedAt,
      sourceUrl,
      reportingCurrency: "TWD",
      displayCurrency: "USD",
      derived: true,
      metrics: { ...values, operatingExpenses: values.grossProfit - values.operatingIncome },
      grossProfitAdjustments: adjustments.map((a) => ({
        label: a.label,
        amount: a.values[i] * 1e6,
        sourceUrl
      }))
    };
    validatePeriod(period);
    return period;
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
  const adjustments = statement.rows
    .filter((row) =>
      /^(?:REALIZED|UNREALIZED|\(UNREALIZED\)).*GROSS PROFIT ON SALES TO ASSOCIATES$/.test(
        row[0] ?? ""
      )
    )
    .map((row) => ({
      label: row[0],
      values: rowNumbers({ ...statement, rows: [row] }, /./, dates.years.length * 2)
    }));
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
      if (adjustments.length)
        period.grossProfitAdjustments = adjustments.map((a) => ({
          label: a.label,
          amount: a.values[index * 2] * 1_000,
          sourceUrl
        }));
      validatePeriod(period);
      return period;
    })
    .sort((a, b) => a.endDate.localeCompare(b.endDate));
}
