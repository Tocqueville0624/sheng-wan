import { readFileSync } from "node:fs";
import { readGenericFiling } from "../../../scripts/finance/generic-import";
import { companyFromFilingPeriods } from "../../../scripts/finance/current-filing";
import type { CatalogCompany, PeriodV2 } from "../../../src/features/finance/v2-types";
export const dardenCases = [
  "FY2017",
  "FY2018",
  "FY2024",
  "FY2026",
  "2024-Q1",
  "2024-Q2",
  "2024-Q3",
  "2025-Q1",
  "2025-Q3",
  "2023-Q1",
  "2026-Q1",
  "2026-Q3",
  "2027-Q1"
] as const;
export function dardenFixture(id: string, sourceOnly = false) {
  const stem = `dri-${id.toLowerCase()}-original-primary-business`,
    source = JSON.parse(readFileSync(new URL(`./${stem}.json`, import.meta.url), "utf8")),
    html = readFileSync(new URL(`./${stem}.html`, import.meta.url), "utf8"),
    identity: CatalogCompany = {
      ticker: "DRI",
      name: "Darden Restaurants",
      cik: source.cik,
      sector: "Consumer Discretionary",
      universe: "sp500"
    },
    retained = source.period as PeriodV2,
    periods = readGenericFiling(
      html,
      identity,
      source.filing,
      sourceOnly ? undefined : companyFromFilingPeriods(identity, [retained]),
      []
    ),
    period = periods.find((p) =>
      sourceOnly ? p.endDate === source.filing.reportDate : p.id === id
    )!;
  return { source, html, identity, retained, periods, period };
}
