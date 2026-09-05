import { companies } from "./companies";
import { filingAdapters } from "./adapters";
import { companyFilings, fetchSec, filingHtmlDocuments } from "./sec-client";
import { tsmFinancialExhibits } from "./sec-shared";
import { parseInlineXbrl, extractInlinePeriods } from "./ixbrl";
import { extractTsmHtml } from "./tsm-html";
import { averageRate, fetchTaiwanDollarRates } from "./fed";
import { convertPeriodToUsd } from "./extract";
import { assertPublishableManifest } from "./validate";
import type {
  CompanyDataset,
  FinanceManifest,
  FinancialPeriod
} from "../../src/features/finance/types";

export async function crawlOfficialManifest(): Promise<FinanceManifest> {
  const updatedAt = new Date().toISOString();
  const datasets: CompanyDataset[] = [];
  for (const company of companies) {
    const adapter = filingAdapters[company.ticker];
    if (!adapter) throw new Error(`${company.ticker}: no reviewed dimension adapter.`);
    const filings = await companyFilings(company.cik);
    const annual = filings
      .filter((filing) => filing.form === (company.ticker === "TSM" ? "20-F" : "10-K"))
      .slice(0, 1);
    const quarterly =
      company.ticker === "TSM"
        ? filings
            .filter(
              (filing) =>
                filing.form === "6-K" &&
                /^tsm-fsx/i.test(filing.primaryDocument) &&
                !filing.reportDate.endsWith("-12-31")
            )
            .slice(0, 3)
        : filings.filter((filing) => filing.form === "10-Q").slice(0, 3);
    if (!annual.length || !quarterly.length)
      throw new Error(`${company.ticker}: current annual/quarterly filings were not discovered.`);
    const periods = new Map<string, FinancialPeriod>();
    for (const filing of [...annual, ...quarterly]) {
      let extracted: FinancialPeriod[];
      if (company.ticker === "TSM" && filing.form === "6-K") {
        const exhibits = (await filingHtmlDocuments(filing)).filter(
          (url) => tsmFinancialExhibits([new URL(url).pathname.split("/").at(-1)!]).length === 1
        );
        if (exhibits.length !== 1)
          throw new Error(
            `TSM: expected one exact consolidated financial report exhibit in ${filing.sourceUrl}.`
          );
        extracted = extractTsmHtml(await fetchSec(exhibits[0]), exhibits[0], filing.filedAt);
      } else {
        const html = await fetchSec(filing.sourceUrl);
        extracted = extractInlinePeriods(
          parseInlineXbrl(html),
          company,
          adapter,
          filing.sourceUrl,
          filing.filedAt
        );
      }
      if (!extracted.length)
        throw new Error(
          `${company.ticker}: no source-reconciled business revenue extracted from ${filing.sourceUrl}.`
        );
      const expectedKind =
        filing.form === "10-K" || filing.form === "20-F" ? "annual" : "quarterly";
      if (
        !extracted.some(
          (period) => period.endDate === filing.reportDate && period.kind === expectedKind
        )
      )
        throw new Error(
          `${company.ticker}: the current filing period lacks a complete reconciled business breakdown; comparative data alone is not a successful refresh.`
        );
      for (const period of extracted) {
        period.accession = filing.accession;
        const key = `${period.kind}:${period.startDate}:${period.endDate}`;
        const prior = periods.get(key);
        if (!prior || prior.filedAt < period.filedAt) periods.set(key, period);
      }
    }
    let history = [...periods.values()].sort((a, b) => a.endDate.localeCompare(b.endDate));
    if (company.reportingCurrency === "TWD") {
      const fx = await fetchTaiwanDollarRates();
      history = history.map((period) =>
        convertPeriodToUsd(
          period,
          averageRate(fx.observations, period.startDate, period.endDate),
          fx.sourceUrl
        )
      );
    }
    const annualPeriods = history.filter((period) => period.kind === "annual");
    const quarterlyPeriods = history.filter((period) => period.kind === "quarterly");
    datasets.push({
      schemaVersion: 1,
      version: "pending",
      ticker: company.ticker,
      name: company.name,
      cik: company.cik,
      accent: company.accent,
      reportingCurrency: company.reportingCurrency,
      latestPeriod: history.at(-1)!.label,
      dataStatus: "verified",
      updatedAt,
      note:
        company.ticker === "TSM"
          ? "Automatically extracted from SEC 20-F inline XBRL and exact 6-K consolidated statement tables. Native TWD is converted consistently using Federal Reserve period-average rates. Operating expenses are net of reported other operating income."
          : "Automatically extracted from SEC annual and quarterly inline-XBRL filings. Business categories are matched by exact taxonomy dimensions and reconcile to reported revenue; coverage reflects available reviewed filings, not estimates.",
      annual: annualPeriods,
      quarterly: quarterlyPeriods
    });
    process.stdout.write(
      `${company.ticker}: ${annualPeriods.length} annual + ${quarterlyPeriods.length} quarterly periods, source-reconciled.\n`
    );
  }
  const manifest: FinanceManifest = {
    schemaVersion: 1,
    version: "pending",
    updatedAt,
    dataStatus: "verified",
    note: "All companies use automatically extracted official SEC statements with reconciled business revenue; no synthetic data.",
    companies: datasets
  };
  assertPublishableManifest(manifest);
  return manifest;
}
