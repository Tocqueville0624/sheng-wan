import { readFileSync } from "node:fs";
import source from "./alb-2022-q2-original-operating-gains.json" with { type: "json" };
import { readGenericFiling } from "../../../scripts/finance/generic-import";
import { companyFromFilingPeriods } from "../../../scripts/finance/current-filing";
import type { CatalogCompany, PeriodV2 } from "../../../src/features/finance/v2-types";
import type { SecFiling } from "../../../scripts/finance/sec-shared";
export const albemarleInlineIdentity: CatalogCompany = {
  ticker: "ALB",
  cik: "0000915913",
  name: "Albemarle Corporation",
  sector: "Materials",
  universe: "sp500"
};
export const albemarleInlineFiling: SecFiling = {
  accession: "0000915913-22-000137",
  filedAt: "2022-08-03",
  reportDate: "2022-06-30",
  form: "10-Q",
  primaryDocument: "alb-20220630.htm",
  sourceUrl: source.sourceUrl,
  directoryUrl: source.sourceUrl.slice(0, source.sourceUrl.lastIndexOf("/") + 1)
};
export const albemarleInlineHtml = readFileSync(
  new URL("./alb-2022-q2-original-operating-gains.html", import.meta.url),
  "utf8"
);
export const albemarleInlineBasic = source.period as PeriodV2;
export function albemarleInlineFixture(mode: "preserved" | "source-only" = "preserved") {
  const basic = structuredClone(albemarleInlineBasic),
    identity = albemarleInlineIdentity,
    filing = albemarleInlineFiling;
  const changes = readGenericFiling(
    albemarleInlineHtml,
    identity,
    filing,
    mode === "preserved" ? companyFromFilingPeriods(identity, [basic]) : undefined
  );
  const period = changes.find((p) => p.id === (mode === "preserved" ? "2021-Q2" : "2022-Q2"));
  if (!period?.coverage.sankey || !period.coverage.segments)
    throw Error("Original quarterly income/business source did not validate.");
  return { period, company: companyFromFilingPeriods(identity, [period]), basic, changes };
}
