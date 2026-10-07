import { readFileSync } from "node:fs";
import { readGenericFiling } from "../../../scripts/finance/generic-import";
import { companyFromFilingPeriods } from "../../../scripts/finance/current-filing";
import type { CatalogCompany, PeriodV2 } from "../../../src/features/finance/v2-types";

export const originalHierarchyCases = [
  ["AVY", "FY2021"],
  ["AVY", "FY2022"],
  ["AVY", "FY2025"],
  ["AVY", "2023-Q1"],
  ["AVY", "2024-Q2"],
  ["AVY", "2026-Q1"],
  ["AVY", "2026-Q2"],
  ["BAX", "FY2021"],
  ["BAX", "FY2022"],
  ["BAX", "FY2025"],
  ["BAX", "2024-Q1"],
  ["BAX", "2026-Q2"]
] as const;

export function originalHierarchyFixture(ticker: "AVY" | "BAX", id: string, sourceOnly = false) {
  const stem = `${ticker.toLowerCase()}-${id.toLowerCase()}-original-hierarchy`;
  const source = JSON.parse(readFileSync(new URL(`./${stem}.json`, import.meta.url), "utf8"));
  const html = readFileSync(new URL(`./${stem}.html`, import.meta.url), "utf8");
  const identity: CatalogCompany = {
    ticker,
    name: ticker === "AVY" ? "Avery Dennison" : "Baxter International",
    cik: source.cik,
    sector: ticker === "AVY" ? "Materials" : "Health Care",
    universe: "sp500"
  };
  const retained = source.period as PeriodV2;
  const periods = readGenericFiling(
    html,
    identity,
    source.filing,
    sourceOnly ? undefined : companyFromFilingPeriods(identity, [retained]),
    []
  );
  const period = periods.find((p) =>
    sourceOnly ? p.endDate === source.filing.reportDate : p.id === id
  )!;
  return { source, html, identity, retained, periods, period };
}
