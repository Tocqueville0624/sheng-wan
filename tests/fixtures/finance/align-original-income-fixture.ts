import { readFileSync } from "node:fs";
import { readGenericFiling } from "../../../scripts/finance/generic-import";
import { companyFromFilingPeriods } from "../../../scripts/finance/current-filing";
import type { CatalogCompany } from "../../../src/features/finance/v2-types";
export function alignOriginalIncomeFixture() {
  const source = JSON.parse(
    readFileSync(new URL("./align-fy2019-original-income.json", import.meta.url), "utf8")
  );
  const html = readFileSync(
    new URL("./align-fy2019-original-income.html", import.meta.url),
    "utf8"
  );
  const identity: CatalogCompany = {
    ticker: "ALGN",
    name: "Align Technology, Inc.",
    cik: source.cik,
    sector: "Health Care",
    universe: "sp500"
  };
  const periods = readGenericFiling(
    html,
    identity,
    source.filing,
    companyFromFilingPeriods(identity, [source.preservedPeriod]),
    []
  );
  const period = periods.find((p) => p.id === "FY2019")!;
  return { source, html, identity, period, company: companyFromFilingPeriods(identity, [period]) };
}
