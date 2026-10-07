import { readFileSync } from "node:fs";
import { readGenericFiling } from "../../../scripts/finance/generic-import";
import { companyFromFilingPeriods } from "../../../scripts/finance/current-filing";
import type { SecFiling } from "../../../scripts/finance/sec-shared";
import type { CatalogCompany, PeriodV2 } from "../../../src/features/finance/v2-types";

export const originalBusinessCases = {
  UNHAnnual: "unitedhealth-fy2025",
  UNHQuarter: "unitedhealth-2026-q2",
  UNHLegacyAnnual: "unitedhealth-fy2019",
  LRCXAnnual: "lam-fy2026",
  LRCXQuarter: "lam-2026-q3",
  LRCXFirstQuarter: "lam-2026-q1",
  LRCXLegacyQuarter: "lam-2022-q2",
  HOODAnnual: "robinhood-fy2025",
  HOODQuarter: "robinhood-2026-q2",
  HOODFirstQuarter: "robinhood-2026-q1",
  HOODLegacyMillion: "robinhood-fy2023",
  HOODLegacyThousand: "robinhood-fy2021-thousands"
} as const;
export type OriginalBusinessCase = keyof typeof originalBusinessCases;
export function originalBusinessSource(name: OriginalBusinessCase) {
  const prefix = `${originalBusinessCases[name]}-original-primary-business`;
  const source = JSON.parse(readFileSync(new URL(`./${prefix}.json`, import.meta.url), "utf8")) as {
    cik: string;
    ticker: string;
    filing: SecFiling;
    excerptSha256: string;
    period: PeriodV2;
    preservedPeriod?: PeriodV2;
  };
  const identity: CatalogCompany = {
    ticker: source.ticker,
    cik: source.cik,
    name:
      source.ticker === "UNH"
        ? "UnitedHealth Group Incorporated"
        : source.ticker === "LRCX"
          ? "Lam Research Corporation"
          : "Robinhood Markets, Inc.",
    sector:
      source.ticker === "UNH"
        ? "Health Care"
        : source.ticker === "LRCX"
          ? "Information Technology"
          : "Financials",
    universe: "sp500"
  };
  return {
    source,
    identity,
    filing: source.filing,
    html: readFileSync(new URL(`./${prefix}.html`, import.meta.url), "utf8")
  };
}
export function originalBusinessFixture(
  name: OriginalBusinessCase,
  mode: "preserved" | "source-only" = "preserved"
) {
  const s = originalBusinessSource(name);
  const basic = structuredClone(s.source.preservedPeriod ?? s.source.period);
  delete basic.segments;
  delete basic.segmentBasis;
  delete basic.segmentSourceUrl;
  delete basic.businessBreakdownSource;
  delete basic.revenueAdjustments;
  basic.coverage.segments = false;
  const changes = readGenericFiling(
    s.html,
    s.identity,
    s.filing,
    mode === "preserved" ? companyFromFilingPeriods(s.identity, [basic]) : undefined,
    []
  );
  const p = changes.find((p) => p.id === (mode === "preserved" ? basic.id : s.source.period.id));
  if (!p?.coverage.segments || !p.coverage.sankey)
    throw Error(`Original business fixture did not reconcile: ${name}/${mode}`);
  return { ...s, basic, period: p, company: companyFromFilingPeriods(s.identity, [p]) };
}
