/**
 * Coverage audit for on-demand (generic) SEC imports.
 *
 * Runs the same extraction steps as the Worker's generic import path against real
 * SEC sources, without writing to any deployed store, and reports which periods can
 * show a reconciled profit flow (Sankey) or business breakdown.
 *
 *   pnpm data:coverage -- ORCL V COST          audit specific catalog tickers
 *   pnpm data:coverage -- --sample             audit the built-in S&P 500 sample
 *   pnpm data:coverage -- --offline ...        use only previously cached SEC sources
 *
 * Options: --max-filings N (default 30, the Worker limit), --force (bypass cache).
 * SEC responses are cached under the ignored .cache/finance/sec/ directory. Each
 * report also shows the previous engine's result (standard concepts and business
 * rows only, without statement-row reading) from the same downloaded sources.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import catalogData from "../../src/data/generated/finance-catalog.json" with { type: "json" };
import type { FinanceCatalog } from "../../src/features/finance/v2-types";
import { auditCompany, type CompanyReport } from "./coverage-audit";
import { fetchSec, readSecCache } from "./sec-client";

const catalog = catalogData as FinanceCatalog;
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const offline = args.includes("--offline");
const maxFilings = Number(option("--max-filings") ?? 30);

/** A fixed, reviewable cross-sector sample of widely followed S&P 500 issuers. */
export const coverageSample = [
  ...["AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CRM", "ADBE", "AMD", "CSCO", "ACN"],
  ...["IBM", "INTU", "TXN", "QCOM", "NOW", "INTC", "MU", "PLTR", "ADP", "PANW"],
  ...["AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "LOW", "BKNG", "TJX", "GM"],
  ...["GOOGL", "META", "NFLX", "DIS", "VZ", "T", "CMCSA"],
  ...["WMT", "COST", "PG", "KO", "PEP", "PM", "MO", "CL", "MDLZ", "KR"],
  ...["LLY", "UNH", "JNJ", "ABBV", "MRK", "TMO", "ABT", "PFE", "AMGN", "CVS"],
  ...["JPM", "BAC", "V", "MA", "GS", "AXP", "SPGI", "BRK.B", "PYPL", "BLK"],
  ...["GE", "CAT", "RTX", "HON", "UNP", "BA", "DE", "UPS", "LMT", "MMM"],
  ...["XOM", "CVX", "COP", "SLB"],
  ...["LIN", "SHW", "NEM", "FCX"],
  ...["NEE", "SO", "DUK"],
  ...["PLD", "AMT", "EQIX"]
];

async function source(url: string, maxAgeMs = Infinity) {
  if (!offline) return fetchSec(url, maxAgeMs);
  const cached = await readSecCache(url);
  if (cached === undefined) throw new Error(`Offline source is not cached: ${url}`);
  return cached;
}

async function main() {
  const tickers = args.includes("--sample")
    ? coverageSample
    : args.filter(
        (arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--max-filings")
      );
  if (!tickers.length) throw new Error("Pass catalog tickers or --sample.");
  const reports: CompanyReport[] = [];
  for (const ticker of tickers) {
    const identity = catalog.companies.find(
      (c) => c.ticker === ticker.toUpperCase().replace("-", ".")
    );
    if (!identity) {
      reports.push({ ticker, sector: "", status: "error", error: "Not in the catalog." });
      continue;
    }
    try {
      reports.push(await auditCompany(identity, source, maxFilings));
    } catch (error) {
      reports.push({
        ticker: identity.ticker,
        sector: identity.sector,
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      });
    }
    const last = reports.at(-1)!;
    process.stdout.write(
      `${last.ticker.padEnd(6)} ${last.status === "ok" ? `sankey ${last.sankey!.padEnd(6)} (before ${last.previousSankey!.padEnd(6)}) segments ${last.segments!.padEnd(6)} latest FY ${last.latestAnnualSankey ? "yes" : "NO "}  ${last.latestAnnualSankey ? "" : (last.annual!.at(-1)?.reason ?? "no annual period")}` : `error: ${last.error}`}\n`
    );
  }
  const ok = reports.filter((r) => r.status === "ok");
  const summary = {
    companies: reports.length,
    errors: reports.length - ok.length,
    latestAnnualSankey: ok.filter((r) => r.latestAnnualSankey).length,
    latestQuarterSankey: ok.filter((r) => r.latestQuarterSankey).length,
    previousLatestAnnualSankey: ok.filter((r) => r.previousLatestAnnualSankey).length
  };
  const directory = path.join(process.cwd(), ".cache", "finance", "coverage");
  await mkdir(directory, { recursive: true });
  const file = path.join(
    directory,
    `report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  await writeFile(
    file,
    JSON.stringify({ createdAt: new Date().toISOString(), maxFilings, summary, reports }, null, 1)
  );
  process.stdout.write(
    `\nLatest annual Sankey: ${summary.latestAnnualSankey}/${ok.length} (previous engine ${summary.previousLatestAnnualSankey}/${ok.length}); latest quarter: ${summary.latestQuarterSankey}/${ok.length}; errors: ${summary.errors}.\nReport: ${path.relative(process.cwd(), file)}\n`
  );
}

await main();
