import { readFileSync } from "node:fs";
import { readGenericFiling } from "../../../scripts/finance/generic-import";
import { companyFromFilingPeriods } from "../../../scripts/finance/current-filing";
import type { CatalogCompany, PeriodV2 } from "../../../src/features/finance/v2-types";

export function churchDwightOriginalFixture(
  kind: "annual" | "quarterly" | "historical",
  sourceOnly = false
) {
  const stem =
    kind === "historical" ? "chd-fy2017" : kind === "annual" ? "chd-fy2025" : "chd-2026-q2";
  const source = JSON.parse(
    readFileSync(new URL(`./${stem}-original-review.json`, import.meta.url), "utf8")
  );
  const html = readFileSync(new URL(`./${stem}-original-review.html`, import.meta.url), "utf8");
  const identity: CatalogCompany = {
    ticker: "CHD",
    name: "Church & Dwight Co., Inc.",
    cik: source.cik,
    sector: "Consumer Staples",
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
  const period = periods.find((p) => p.id === retained.id)!;
  return { source, html, identity, retained, periods, period };
}
