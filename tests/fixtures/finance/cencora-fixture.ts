import { readFileSync } from "node:fs";
import { readGenericFiling } from "../../../scripts/finance/generic-import";
import { companyFromFilingPeriods } from "../../../scripts/finance/current-filing";
import type { CatalogCompany, PeriodV2 } from "../../../src/features/finance/v2-types";

export const cencoraCases = [
  "FY2017",
  "FY2019",
  "FY2022",
  "FY2025",
  "2026-Q1",
  "2026-Q2",
  "2026-Q3",
  "2021-Q2"
] as const;

export function cencoraFixture(id: string, sourceOnly = false) {
  const stem = `cor-${id.toLowerCase()}-original-hierarchy`;
  const source = JSON.parse(readFileSync(new URL(`./${stem}.json`, import.meta.url), "utf8"));
  const html = readFileSync(new URL(`./${stem}.html`, import.meta.url), "utf8");
  const identity: CatalogCompany = {
    ticker: "COR",
    name: "Cencora",
    cik: source.cik,
    sector: "Health Care",
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
