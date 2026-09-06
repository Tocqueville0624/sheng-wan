import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filingAdapters } from "../scripts/finance/adapters";
import { companies } from "../scripts/finance/companies";
import { convertPeriodToUsd } from "../scripts/finance/extract";
import {
  enrichSegmentGrossProfits,
  extractInlinePeriods,
  parseInlineXbrl
} from "../scripts/finance/ixbrl";
import { validatePeriod, validateSegmentGrossProfits } from "../scripts/finance/validate";
import { mergeV2, upgradeCompany, validateV2 } from "../scripts/finance/v2-model";
import snapshot from "../src/data/generated/finance.json";
import type { CompanyDataset, FinancialPeriod } from "../src/features/finance/types";

const sources = {
  AAPL: { file: "aapl-2025-business-gross.html", filedAt: "2025-10-31" },
  MSFT: { file: "msft-2026-business-gross.html", filedAt: "2026-07-29" }
} as const;
const parsedFiling = (ticker: keyof typeof sources) =>
  parseInlineXbrl(
    readFileSync(new URL(`./fixtures/finance/${sources[ticker].file}`, import.meta.url), "utf8")
  );
const actualPeriod = (ticker: keyof typeof sources) =>
  extractInlinePeriods(
    parsedFiling(ticker),
    companies.find((company) => company.ticker === ticker)!,
    filingAdapters[ticker],
    filingAdapters[ticker].annualUrls[0],
    sources[ticker].filedAt
  )[0];
const withoutGrossProfit = (period: FinancialPeriod): FinancialPeriod => ({
  ...period,
  segments: period.segments?.map(({ id, label, revenue }) => ({ id, label, revenue }))
});
const enrichApple = (period: FinancialPeriod, parsed = parsedFiling("AAPL")) =>
  enrichSegmentGrossProfits(period, parsed, filingAdapters.AAPL, filingAdapters.AAPL.annualUrls[0]);
const service = (period: FinancialPeriod) =>
  period.segments!.find((segment) => segment.id === "services")!;

describe("source-grounded business gross profit", () => {
  it("calculates Apple's Services gross margin from the same FY2025 statement category", () => {
    const period = actualPeriod("AAPL");
    expect(service(period).revenue).toBe(109_158_000_000);
    expect(service(period).grossProfit).toBe(82_314_000_000);
    expect((service(period).grossProfit! / service(period).revenue) * 100).toBeCloseTo(
      75.408124,
      6
    );
    expect(service(period).grossProfitSource).toEqual({
      sourceUrl: filingAdapters.AAPL.annualUrls[0],
      accession: "0000320193-25-000079",
      filedAt: "2025-10-31",
      startDate: "2024-09-29",
      endDate: "2025-09-27",
      reportingCurrency: "USD",
      method: "revenue-minus-cost",
      revenueTag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
      tag: "us-gaap:CostOfGoodsAndServicesSold",
      dimensions: { "srt:ProductOrServiceAxis": "us-gaap:ServiceMember" },
      value: 26_844_000_000
    });
    expect(() => validatePeriod(period)).not.toThrow();
  });

  it("never allocates aggregate Products or geographic costs to iPhone, Mac, iPad or Wearables", () => {
    const period = actualPeriod("AAPL");
    expect(
      parsedFiling("AAPL").facts.some(
        (fact) =>
          fact.context.dimensions["srt:ProductOrServiceAxis"] === "us-gaap:ProductMember" &&
          /CostOf/.test(fact.tag)
      )
    ).toBe(true);
    for (const segment of period.segments!.filter((item) => item.id !== "services")) {
      expect(segment.grossProfit).toBeUndefined();
      expect(segment.grossProfitSource).toBeUndefined();
    }
  });

  it("uses the three exact Microsoft segment costs without substituting segment operating profit", () => {
    const period = actualPeriod("MSFT");
    expect(period.segments?.map((segment) => segment.grossProfitSource?.value)).toEqual([
      25_017_000_000, 57_876_000_000, 23_481_000_000
    ]);
    expect(period.segments?.map((segment) => segment.grossProfit)).toEqual([
      114_979_000_000, 79_915_000_000, 30_571_000_000
    ]);
    expect(
      period.segments?.every(
        (segment) => segment.grossProfitSource?.tag === "us-gaap:CostOfGoodsAndServicesSold"
      )
    ).toBe(true);
    const parsed = parsedFiling("MSFT");
    parsed.facts = parsed.facts.filter((fact) => !/CostOf/.test(fact.tag));
    const missing = enrichSegmentGrossProfits(
      withoutGrossProfit(period),
      parsed,
      filingAdapters.MSFT,
      period.sourceUrl
    );
    expect(missing.segments?.every((segment) => segment.grossProfit === undefined)).toBe(true);
  });

  it("supplements existing snapshots without changing their income statement or business revenue", () => {
    const original = withoutGrossProfit(actualPeriod("AAPL"));
    const enriched = enrichApple(original);
    expect(enriched.metrics).toEqual(original.metrics);
    expect(withoutGrossProfit(enriched)).toEqual(original);
    expect(service(original).grossProfit).toBeUndefined();
    const mismatch = structuredClone(original);
    service(mismatch).revenue += 1_000_000;
    expect(() => enrichApple(mismatch)).toThrow(/revenue mismatch/);
    expect(() =>
      enrichApple({ ...original, sourceUrl: original.sourceUrl + "?different-source" })
    ).toThrow(/filing/);
  });

  it("withholds a margin when cost belongs to another period, issuer, currency or dimensional scope", () => {
    const original = withoutGrossProfit(actualPeriod("AAPL"));
    for (const mismatch of ["period", "issuer", "currency", "dimension", "typed"] as const) {
      const parsed = parsedFiling("AAPL");
      for (const fact of parsed.facts.filter(
        (fact) =>
          /CostOf/.test(fact.tag) &&
          fact.context.dimensions["srt:ProductOrServiceAxis"] === "us-gaap:ServiceMember"
      )) {
        fact.context = structuredClone(fact.context);
        if (mismatch === "period") fact.context.start = "2024-09-30";
        if (mismatch === "issuer") fact.context.cik = "0000789019";
        if (mismatch === "currency") fact.currency = "TWD";
        if (mismatch === "dimension")
          fact.context.dimensions["example:ExtraAxis"] = "example:ChildMember";
        if (mismatch === "typed") fact.context.typed = true;
      }
      expect(service(enrichApple(original, parsed)).grossProfit, mismatch).toBeUndefined();
    }
  });

  it("rejects conflicting equally precise costs and inconsistently reported gross profit", () => {
    const original = withoutGrossProfit(actualPeriod("AAPL"));
    const parsed = parsedFiling("AAPL");
    const cost = parsed.facts.find(
      (fact) =>
        /CostOf/.test(fact.tag) &&
        fact.context.dimensions["srt:ProductOrServiceAxis"] === "us-gaap:ServiceMember"
    )!;
    parsed.facts.push({ ...cost, value: cost.value + 1_000_000 });
    expect(() => enrichApple(original, parsed)).toThrow(/Conflicting/);
    parsed.facts.pop();
    parsed.facts.push({ ...cost, tag: "us-gaap:GrossProfit", value: 82_315_000_000 });
    expect(() => enrichApple(original, parsed)).toThrow(/conflicting business gross profit/);
  });

  it("preserves a directly reported gross loss instead of replacing it with operating income or zero", () => {
    // Deliberately changed test facts, never production data.
    const original = withoutGrossProfit(actualPeriod("AAPL"));
    const parsed = parsedFiling("AAPL");
    parsed.facts = parsed.facts.filter((fact) => !/CostOf/.test(fact.tag));
    const revenue = parsed.facts.find(
      (fact) => fact.context.dimensions["srt:ProductOrServiceAxis"] === "us-gaap:ServiceMember"
    )!;
    parsed.facts.push({ ...revenue, tag: "us-gaap:GrossProfit", value: -1_000_000 });
    const result = service(enrichApple(original, parsed));
    expect(result.grossProfit).toBe(-1_000_000);
    expect(result.grossProfitSource?.method).toBe("reported");
  });

  it("requires matching provenance and the exact reported input when validating saved data", () => {
    const period = actualPeriod("AAPL");
    const corruptions = [
      (p: FinancialPeriod) => {
        delete service(p).grossProfitSource;
      },
      (p: FinancialPeriod) => {
        delete service(p).grossProfit;
      },
      (p: FinancialPeriod) => {
        service(p).grossProfit = Infinity;
      },
      (p: FinancialPeriod) => {
        service(p).grossProfit! += 1_000_000;
      },
      (p: FinancialPeriod) => {
        service(p).grossProfitSource!.endDate = "2025-06-28";
      },
      (p: FinancialPeriod) => {
        service(p).grossProfitSource!.reportingCurrency = "TWD";
      },
      (p: FinancialPeriod) => {
        service(p).grossProfitSource!.tag = "us-gaap:OperatingIncomeLoss";
      },
      (p: FinancialPeriod) => {
        service(p).grossProfitSource!.sourceUrl = "https://evil.test/";
      },
      (p: FinancialPeriod) => {
        service(p).grossProfitSource!.value = -1;
      },
      (p: FinancialPeriod) => {
        p.revenueAdjustments = [{ ...service(p), id: "hedging", revenue: 0 }];
      }
    ];
    for (const corrupt of corruptions) {
      const next = structuredClone(period);
      corrupt(next);
      expect(() => validateSegmentGrossProfits(next)).toThrow();
    }
  });

  it("converts gross profit with revenue while retaining the original source amount", () => {
    // Currency changed only to exercise conversion with a small, deterministic rate.
    const native = actualPeriod("AAPL");
    native.reportingCurrency = "TWD";
    service(native).grossProfitSource!.reportingCurrency = "TWD";
    const converted = convertPeriodToUsd(native, 2, "https://www.federalreserve.gov/example");
    expect(service(converted).revenue).toBe(54_579_000_000);
    expect(service(converted).grossProfit).toBe(41_157_000_000);
    expect(service(converted).grossProfitSource!.value).toBe(26_844_000_000);
    expect(service(converted).grossProfit! / service(converted).revenue).toBe(
      service(native).grossProfit! / service(native).revenue
    );
    expect(() => validatePeriod(converted)).not.toThrow();
  });

  it("keeps a same-statement optional source through legacy v1/v2 reads but never through changed facts", () => {
    const company = structuredClone(
      snapshot.companies.find((company) => company.ticker === "AAPL")!
    ) as CompanyDataset;
    const index = company.annual.findIndex((period) => period.id === "FY2025");
    company.annual[index] = enrichApple(company.annual[index]);
    const richer = upgradeCompany(company);
    const legacy = structuredClone(richer);
    legacy.annual[index].segments = withoutGrossProfit(company.annual[index]).segments;
    const merged = mergeV2(richer, legacy);
    expect(merged.annual[index].segments).toEqual(richer.annual[index].segments);
    expect(() => validateV2(merged)).not.toThrow();
    const changed = structuredClone(legacy);
    changed.annual[index].segmentBasis += " Changed classification.";
    expect(mergeV2(richer, changed).annual[index].segments).toEqual(legacy.annual[index].segments);
    expect(() => validateV2(legacy)).not.toThrow();
  });
});
