import { describe, expect, it } from "vitest";
import bundled from "../src/data/generated/finance.json";
import { upgradeCompany, validateV2, mergeV2 } from "../scripts/finance/v2-model";
import {
  extractFactsV2,
  parseFactsDocument,
  convertBasicTwd,
  type FactsDocument
} from "../scripts/finance/facts-v2";
import {
  parseFilings,
  readBounded,
  assertSecUrl,
  tsmFinancialExhibits,
  type SecFiling
} from "../scripts/finance/sec-shared";
import { apiV2 } from "../worker/index";
import { catalogIdentity, catalog } from "../worker/finance-store";
import type { CompanyDataset } from "../src/features/finance/types";
import { historySlots } from "../src/features/finance/history-slots";

const identity = catalogIdentity("WMT")!;
const accession = "0000104169-26-000001";
const filing: SecFiling = {
  accession,
  filedAt: "2026-03-01",
  reportDate: "2026-01-31",
  form: "10-K",
  primaryDocument: "wmt.htm",
  directoryUrl: `https://www.sec.gov/Archives/edgar/data/104169/${accession.replaceAll("-", "")}/`,
  sourceUrl: `https://www.sec.gov/Archives/edgar/data/104169/${accession.replaceAll("-", "")}/wmt.htm`
};
// Unit fixtures are deliberately tiny and are never copied into public data.
function fixture(): FactsDocument {
  const fact = (val: number) => ({
    start: "2025-02-01",
    end: "2026-01-31",
    val,
    accn: accession,
    fy: 2026,
    fp: "FY",
    form: "10-K",
    filed: "2026-03-01"
  });
  return {
    cik: 104169,
    entityName: "Fixture issuer",
    facts: {
      "us-gaap": {
        Revenues: { label: "Revenues", units: { USD: [fact(100)] } },
        NetIncomeLoss: { label: "Net income", units: { USD: [fact(-5)] } }
      }
    }
  };
}
describe("finance v2 provenance and coverage", () => {
  it("uses a taxonomy identifier when SEC IFRS concepts have null labels", () => {
    const doc = fixture();
    doc.facts["us-gaap"].Revenues.label = null;
    const next = extractFactsV2(doc, identity, [filing]);
    expect(next.annual[0].metricSources.revenue?.label).toBe("us-gaap:Revenues");
    expect(() => validateV2(next)).not.toThrow();
  });
  it("converts only native TWD facts with observed FX and preserves missing metrics", () => {
    const doc = fixture();
    for (const concept of Object.values(doc.facts["us-gaap"])) {
      concept.units.TWD = concept.units.USD.map((f) => ({ ...f, val: f.val * 30 }));
    }
    const native = extractFactsV2(doc, identity, [filing], "TWD");
    const period = convertBasicTwd(
      native.annual[0],
      30,
      "https://www.federalreserve.gov/releases/h10/hist/dat00_ta.htm"
    );
    expect(period.metrics).toEqual({ revenue: 100, netIncome: -5 });
    expect(native.annual[0].metrics.revenue).toBe(3000);
    expect(period.displayCurrency).toBe("USD");
    expect(period.reportingCurrency).toBe("TWD");
    expect(period.metricSources.revenue).toMatchObject({
      method: "calculated",
      sourceUrl: filing.sourceUrl,
      inputs: [expect.stringContaining("Native TWD 3000")]
    });
    expect(() => validateV2({ ...native, annual: [period] })).not.toThrow();
    expect(() => convertBasicTwd(period, 30, "https://example.test")).toThrow();
    expect(() => convertBasicTwd(native.annual[0], 0, "https://example.test")).toThrow();
  });
  it("leaves missing fiscal periods visibly empty instead of closing a history gap", () => {
    const periods = upgradeCompany(bundled.companies[0] as CompanyDataset).quarterly;
    const first = { ...periods[0], fiscalYear: 2025, fiscalQuarter: 3 as const };
    const last = { ...periods[1], fiscalYear: 2026, fiscalQuarter: 1 as const };
    const slots = historySlots([first, last]);
    expect(slots).toHaveLength(3);
    expect(slots[1]).toEqual({ fiscalYear: 2025, fiscalQuarter: 4, period: undefined });
    expect(slots[0].period).toBe(first);
    expect(slots[2].period).toBe(last);
  });
  it("normalizes optional undefined adapter fields without inventing zeroes", () => {
    const original = structuredClone(bundled.companies[0]) as CompanyDataset;
    original.annual[0].metrics.equityMethodIncome = undefined;
    const next = upgradeCompany(original);
    expect(Object.hasOwn(next.annual[0].metrics, "equityMethodIncome")).toBe(false);
    expect(() => validateV2(next)).not.toThrow();
  });
  it("retains every verified existing statement during schema upgrade", () => {
    for (const original of bundled.companies) {
      const next = upgradeCompany(original as CompanyDataset);
      expect(() => validateV2(next)).not.toThrow();
      expect(next.annual.map((p) => p.metrics)).toEqual(original.annual.map((p) => p.metrics));
      expect(next.quarterly.every((p) => p.coverage.segments)).toBe(true);
    }
  });
  it("uses the issuer fiscal year, preserves losses and never fills missing metrics with zero", () => {
    const data = extractFactsV2(fixture(), identity, [filing]);
    expect(data.annual[0].label).toBe("FY 2026");
    expect(data.annual[0].metrics).toEqual({ revenue: 100, netIncome: -5 });
    expect(data.annual[0].coverage.sankey).toBe(false);
    expect(data.annual[0].metricSources.netIncome?.sourceUrl).toBe(filing.sourceUrl);
  });
  it("does not join metrics from different accessions", () => {
    const doc = fixture();
    doc.facts["us-gaap"].NetIncomeLoss.units.USD[0].accn = "0000104169-26-000002";
    const data = extractFactsV2(doc, identity, [filing]);
    expect(data.annual[0].metrics.netIncome).toBeUndefined();
  });
  it("does not force unmodeled cost adjustments into a reconciled statement", () => {
    const doc = fixture();
    const fact = doc.facts["us-gaap"].Revenues.units.USD[0];
    doc.facts["us-gaap"].CostOfRevenue = { label: "Cost", units: { USD: [{ ...fact, val: 60 }] } };
    doc.facts["us-gaap"].GrossProfit = { label: "Gross", units: { USD: [{ ...fact, val: 42 }] } };
    expect(() => extractFactsV2(doc, identity, [filing])).toThrow(/No supported/);
  });
  it("fails on conflicting same-tag values and issuer mismatch", () => {
    const doc = fixture();
    doc.facts["us-gaap"].Revenues.units.USD.push({
      ...doc.facts["us-gaap"].Revenues.units.USD[0],
      val: 101
    });
    expect(() => extractFactsV2(doc, identity, [filing])).toThrow(/Conflicting/);
    expect(() => extractFactsV2(fixture(), catalogIdentity("JPM")!, [filing])).toThrow(/CIK/);
  });
  it("does not mistake financial-sector customer-contract revenue for total revenue", () => {
    const doc = fixture();
    doc.facts["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax = {
      label: "Contract revenue",
      units: { USD: [{ ...doc.facts["us-gaap"].Revenues.units.USD[0], val: 40 }] }
    };
    const data = extractFactsV2(doc, { ...identity, sector: "Financials" }, [filing]);
    expect(data.annual[0].metrics.revenue).toBe(100);
    expect(data.annual[0].coverage.sankey).toBe(false);
  });
  it("does not manufacture a fourth quarter from a year alone", () => {
    expect(extractFactsV2(fixture(), identity, [filing]).quarterly).toEqual([]);
  });

  it("does not relabel trailing-twelve-month quarterly disclosures as fiscal years", () => {
    const doc = fixture();
    for (const concept of Object.values(doc.facts["us-gaap"])) {
      for (const f of concept.units.USD) f.fp = "Q2";
    }
    expect(() => extractFactsV2(doc, identity, [filing])).toThrow(/No supported/);
  });
  it("selects only monetary concepts before allocating the JSON document", () => {
    const doc = fixture();
    doc.facts["us-gaap"].UnrelatedLargeConcept = { label: "Unused { string }", units: { USD: [] } };
    expect(
      parseFactsDocument(JSON.stringify(doc)).facts["us-gaap"].UnrelatedLargeConcept
    ).toBeUndefined();
    expect(parseFactsDocument(JSON.stringify(doc)).facts["us-gaap"].Revenues).toEqual(
      doc.facts["us-gaap"].Revenues
    );
  });
  it("never downgrades a detailed period to newer partial basic metrics", () => {
    const original = upgradeCompany(bundled.companies[0] as CompanyDataset);
    const partial = structuredClone(original);
    for (const p of [...partial.annual, ...partial.quarterly]) {
      delete p.segments;
      delete p.revenueAdjustments;
      p.coverage.segments = false;
    }
    const merged = mergeV2(original, partial);
    expect(merged.annual.map((p) => p.segments)).toEqual(original.annual.map((p) => p.segments));
    const corrupt = structuredClone(original);
    corrupt.annual[0].segments![0].revenue += 1e8;
    expect(() => mergeV2(original, corrupt)).toThrow();
    expect(original.annual[0].segments).toEqual(bundled.companies[0].annual[0].segments);
  });
  it("rejects unverified responses, missing provenance, and wrong-issuer sources", () => {
    const data = extractFactsV2(fixture(), identity, [filing]);
    delete data.annual[0].metricSources.revenue;
    expect(() => validateV2(data)).toThrow(/provenance/);
    const wrong = extractFactsV2(fixture(), identity, [filing]);
    wrong.annual[0].metricSources.revenue!.sourceUrl = "https://evil.test/filing";
    expect(() => validateV2(wrong)).toThrow(/issuer/);
  });
});
describe("catalog, limits and compatibility", () => {
  it("keeps public mutations disabled until edge verification is explicitly enabled", async () => {
    let calls = 0;
    const env = {
      FINANCE_STORE: {
        idFromName: () => "fixture",
        get: () => ({
          fetch: async () => {
            calls++;
            return Response.json({ company: null, available: true });
          }
        })
      }
    };
    const res = await apiV2(
      new Request("https://site.test/api/finance/v2/companies/WMT/refresh", { method: "POST" }),
      env as never
    );
    expect(res.status).toBe(503);
    expect(calls).toBe(0);
    const saved = await apiV2(
      new Request("https://site.test/api/finance/v2/companies/WMT"),
      env as never
    );
    expect(await saved.json()).toMatchObject({ available: false });
    expect(calls).toBe(1);
    await apiV2(
      new Request("https://site.test/api/finance/v2/companies/WMT/refresh", { method: "POST" }),
      { ...env, FINANCE_PUBLIC_UPDATES: "enabled" } as never
    );
    expect(calls).toBe(2);
  });
  it("covers the whole sourced catalog and keeps ticker aliases on the same issuer", () => {
    expect(catalog.companies.length).toBeGreaterThanOrEqual(500);
    expect(catalogIdentity("BRK-B")?.ticker).toBe("BRK.B");
    expect(catalogIdentity("GOOG")?.cik).toBe(catalogIdentity("GOOGL")?.cik);
    expect(catalogIdentity("TSM")?.universe).toBe("additional");
    expect(catalog.secMapping?.sourceUrl).toBe("https://www.sec.gov/files/company_tickers.json");
  });
  it("recognizes dated TSM consolidated exhibits without allowing arbitrary paths", () => {
    expect(
      tsmFinancialExhibits([
        "tsmc2025q2consolidatedfina.htm",
        "TSMC2026Q1ConsolidatedReport.htm",
        "../consolidatedreport.htm",
        "press-release.htm"
      ])
    ).toEqual(["tsmc2025q2consolidatedfina.htm", "TSMC2026Q1ConsolidatedReport.htm"]);
  });
  it("does not permit redirects or arbitrary contact-header destinations", async () => {
    expect(() => assertSecUrl("https://sec.gov.evil.test/a")).toThrow();
    expect(() => assertSecUrl("http://data.sec.gov/a")).toThrow();
    await expect(
      readBounded(
        new Response("redirect", { status: 302, headers: { Location: "https://evil.test" } })
      )
    ).rejects.toThrow(/302/);
    await expect(readBounded(new Response("oversized"), 3)).rejects.toThrow(/size/);
  });
  it("excludes future filings and malformed filing paths", () => {
    expect(
      parseFilings(identity.cik, {
        accessionNumber: [accession],
        filingDate: ["2099-01-01"],
        reportDate: ["2026-01-31"],
        form: ["10-K"],
        primaryDocument: ["../evil.htm"]
      })
    ).toEqual([]);
  });
  it("serves bundled data without a binding but does not pretend updates ran", async () => {
    const res = await apiV2(
      new Request("https://site.test/api/finance/v2/companies/AAPL"),
      {} as never
    );
    expect(await res.json()).toMatchObject({
      available: false,
      company: { schemaVersion: 2, ticker: "AAPL" }
    });
    const post = await apiV2(
      new Request("https://site.test/api/finance/v2/companies/WMT/refresh", { method: "POST" }),
      {} as never
    );
    expect(post.status).toBe(503);
  });
  it("rejects cross-origin update requests and read-only refresh calls", async () => {
    expect(
      (
        await apiV2(
          new Request("https://site.test/api/finance/v2/companies/AAPL/refresh", {
            method: "POST",
            headers: { Origin: "https://evil.test" }
          }),
          {} as never
        )
      ).status
    ).toBe(403);
    expect(
      (
        await apiV2(
          new Request("https://site.test/api/finance/v2/companies/AAPL/refresh"),
          {} as never
        )
      ).status
    ).toBe(405);
  });
});
