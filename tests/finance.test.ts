import { describe, expect, it, vi } from "vitest";
import { averageRate, parseH10TaiwanDollar } from "../scripts/finance/fed";
import {
  convertPeriodToUsd,
  extractPeriods,
  isReconciled,
  type CompanyFacts
} from "../scripts/finance/extract";
import { companies } from "../scripts/finance/companies";
import { curatedAppleDataset } from "../scripts/finance/curated";
import { applyCuratedData, assertNoVerifiedDowngrade } from "../scripts/finance/merge";
import { refreshSnapshot } from "../scripts/finance/refresh";
import { validatePeriod } from "../scripts/finance/validate";
import type { FinanceManifest } from "../src/features/finance/types";

const apple = companies.find((company) => company.ticker === "AAPL")!;
const fact = (val: number) => ({
  start: "2025-01-01",
  end: "2025-12-31",
  val,
  accn: "0001-25-000001",
  fy: 2025,
  fp: "FY",
  form: "10-K",
  filed: "2026-02-01"
});
const facts: CompanyFacts = {
  entityName: "Example",
  facts: {
    "us-gaap": {
      RevenueFromContractWithCustomerExcludingAssessedTax: {
        label: "Revenue",
        units: { USD: [fact(100)] }
      },
      CostOfRevenue: { label: "Cost", units: { USD: [fact(60)] } },
      GrossProfit: { label: "Gross", units: { USD: [fact(40)] } },
      OperatingIncomeLoss: { label: "Operating", units: { USD: [fact(20)] } },
      IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: {
        label: "Pretax",
        units: { USD: [fact(18)] }
      },
      IncomeTaxExpenseBenefit: { label: "Tax", units: { USD: [fact(3)] } },
      NetIncomeLoss: { label: "Net", units: { USD: [fact(15)] } }
    }
  }
};

describe("official finance extraction", () => {
  it("aligns facts by exact statement duration", () => {
    const periods = extractPeriods(facts, apple);
    expect(periods).toHaveLength(1);
    expect(periods[0].metrics.operatingExpenses).toBe(20);
    expect(isReconciled(periods[0].metrics)).toBe(true);
  });

  it("parses and averages Fed H.10 observations", () => {
    const observations = parseH10TaiwanDollar(
      "<td>01/02/2025</td><td>32.5</td><td>01/03/2025</td><td>32.7</td>"
    );
    expect(averageRate(observations, "2025-01-02", "2025-01-03")).toBeCloseTo(32.6);
  });

  it("converts all monetary fields to USD", () => {
    const converted = convertPeriodToUsd(extractPeriods(facts, apple)[0], 2, "https://example.com");
    expect(converted.metrics.revenue).toBe(50);
    expect(converted.fx?.rate).toBe(2);
  });

  it("uses a comparative fact's dates, not the year of its later filing", () => {
    const laterFiling = structuredClone(facts);
    for (const item of Object.values(laterFiling.facts["us-gaap"])) {
      item.units.USD[0].fy = 2026;
    }
    expect(extractPeriods(laterFiling, apple)[0].fiscalYear).toBe(2025);
  });

  it("does not reinterpret selling expense alone as total SG&A", () => {
    const partial = structuredClone(facts);
    partial.facts["us-gaap"].SellingAndMarketingExpense = {
      label: "Selling only",
      units: { USD: [fact(3)] }
    };
    expect(
      extractPeriods(partial, apple)[0].metrics.sellingGeneralAndAdministrative
    ).toBeUndefined();
  });

  it("does not use a different reporting currency as a fallback", () => {
    const tsm = companies.find((company) => company.ticker === "TSM")!;
    expect(
      extractPeriods({ ...facts, facts: { "ifrs-full": facts.facts["us-gaap"] } }, tsm)
    ).toHaveLength(0);
  });

  it("rejects invalid conversion rates", () => {
    expect(() =>
      convertPeriodToUsd(extractPeriods(facts, apple)[0], 0, "https://example.com")
    ).toThrow();
    expect(() =>
      convertPeriodToUsd(extractPeriods(facts, apple)[0], NaN, "https://example.com")
    ).toThrow();
  });
});

const manifest = (): FinanceManifest => ({
  schemaVersion: 1,
  version: "test-reviewed",
  updatedAt: "2026-09-01T00:00:00Z",
  dataStatus: "verified",
  companies: [curatedAppleDataset()]
});

describe("reviewed business revenue data", () => {
  it("contains three annual and eight consecutive quarterly source-checked periods", () => {
    const company = curatedAppleDataset();
    expect(company.annual).toHaveLength(3);
    expect(company.quarterly).toHaveLength(8);
    expect(company.quarterly.at(-1)?.id).toBe("2026-Q3");
    for (const period of [...company.annual, ...company.quarterly]) {
      expect(() => validatePeriod(period)).not.toThrow();
      expect(period.segments).toHaveLength(5);
      expect(period.segments!.reduce((sum, segment) => sum + segment.revenue, 0)).toBe(
        period.metrics.revenue
      );
    }
    expect(company.annual.at(-1)?.metrics.revenue).toBe(416_161_000_000);
    expect(company.annual.at(-1)?.metrics.netIncome).toBe(112_010_000_000);
  });

  it("retains the reported FY2024 tax charge, not a non-GAAP adjusted result", () => {
    const fy24 = curatedAppleDataset().annual.find((period) => period.id === "FY2024")!;
    expect(fy24.metrics.incomeTax).toBe(29_749_000_000);
    expect(fy24.metrics.netIncome).toBe(93_736_000_000);
  });

  it("rejects nonfinite or unreconciled segment values instead of normalizing them", () => {
    for (const value of [NaN, Infinity, -1, 100]) {
      const period = structuredClone(curatedAppleDataset().annual[0]);
      period.segments![0].revenue = value;
      expect(() => validatePeriod(period)).toThrow();
    }
    const period = structuredClone(curatedAppleDataset().annual[0]);
    period.segments![0].revenue *= 1.001;
    expect(() => validatePeriod(period)).toThrow(/do not sum/);
  });

  it("rejects duplicate category IDs and missing provenance", () => {
    const period = structuredClone(curatedAppleDataset().annual[0]);
    period.segments![1].id = period.segments![0].id;
    expect(() => validatePeriod(period)).toThrow(/invalid business/);
    const withoutSource = structuredClone(curatedAppleDataset().annual[0]);
    delete withoutSource.segmentSourceUrl;
    expect(() => validatePeriod(withoutSource)).toThrow(/provenance/);
  });

  it("rejects small accounting discrepancies and inconsistent tax/net income", () => {
    const values = { ...curatedAppleDataset().annual[0].metrics };
    values.netIncome += 1_000_000;
    expect(isReconciled(values)).toBe(false);
    values.netIncome = NaN;
    expect(isReconciled(values)).toBe(false);
  });

  it("rejects zero-revenue periods before chart scale or margin calculations", () => {
    const period = structuredClone(curatedAppleDataset().annual[0]);
    for (const key of Object.keys(period.metrics) as (keyof typeof period.metrics)[]) {
      period.metrics[key] = 0;
    }
    period.segments?.forEach((segment) => {
      segment.revenue = 0;
    });
    expect(() => validatePeriod(period)).toThrow(/revenue must be positive/);
  });

  it("converts segment revenue with the same exchange rate as the total", () => {
    const converted = convertPeriodToUsd(curatedAppleDataset().annual[0], 2, "https://example.com");
    expect(converted.segments![0].revenue).toBe(100_291_500_000);
    expect(() => validatePeriod(converted)).not.toThrow();
  });

  it("does not attach older splits to a restated revenue total", () => {
    const current = manifest();
    const restated = current.companies[0].annual[0];
    delete restated.segments;
    delete restated.segmentSourceUrl;
    delete restated.segmentBasis;
    restated.metrics.revenue += 1_000_000;
    restated.metrics.costOfRevenue += 1_000_000;
    const merged = applyCuratedData(current);
    expect(merged.companies[0].annual[0].segments).toBeUndefined();
    expect(merged.companies[0].annual[0].metrics.revenue).toBe(restated.metrics.revenue);
  });
});

describe("refresh safety", () => {
  it("never writes or synthesizes data after a failed official fetch", async () => {
    const persist = vi.fn();
    const previous = manifest();
    await expect(
      refreshSnapshot(
        previous,
        async () => {
          throw new Error("SEC HTTP 403");
        },
        persist
      )
    ).rejects.toThrow("SEC HTTP 403");
    expect(persist).not.toHaveBeenCalled();
    expect(previous.companies[0].dataStatus).toBe("verified");
  });

  it("never writes an invalid refreshed snapshot", async () => {
    const persist = vi.fn();
    const next = manifest();
    next.companies[0].annual[0].segments![0].revenue = Infinity;
    await expect(refreshSnapshot(manifest(), async () => next, persist)).rejects.toThrow();
    expect(persist).not.toHaveBeenCalled();
  });

  it("preserves the real previous snapshot for rollback and prevents demo downgrade", async () => {
    const previous = manifest();
    const next = manifest();
    next.version = "new-reviewed";
    const persist = vi.fn(async () => undefined);
    await refreshSnapshot(previous, async () => next, persist);
    expect(persist).toHaveBeenCalledWith(next, previous);
    const demo = manifest();
    demo.companies[0].dataStatus = "demo";
    expect(() => assertNoVerifiedDowngrade(previous, demo)).toThrow(/refusing/);
    expect(() => assertNoVerifiedDowngrade(previous, { ...next, companies: [] })).toThrow(
      /remove verified/
    );
  });
});
