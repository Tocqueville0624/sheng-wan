import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { FinanceStore, catalog, catalogIdentity } from "../worker/finance-store";
import type { FinanceJob } from "../src/features/finance/v2-types";
import { bundledCompany } from "../worker/finance-store";
import type { CompanyV2 } from "../src/features/finance/v2-types";
import imported from "./fixtures/finance/imported-companies.json";
import history from "../src/data/generated/finance-history.json";
import { businessFixture } from "./fixtures/finance/business-fixtures";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";
import { parseInlineXbrl } from "../scripts/finance/ixbrl";

// A serialized, persistent storage contract. Parsing tests use separate fixtures;
// queue tests never contact SEC or alter the production snapshots.
class Storage {
  data = new Map<string, unknown>();
  alarm: number | null = null;
  private tail = Promise.resolve();
  async get(key: string | string[]) {
    return structuredClone(
      Array.isArray(key)
        ? new Map(key.filter((k) => this.data.has(k)).map((k) => [k, this.data.get(k)]))
        : this.data.get(key)
    );
  }
  async put(key: string | Record<string, unknown>, value?: unknown) {
    for (const [k, v] of typeof key === "string" ? [[key, value]] : Object.entries(key))
      this.data.set(k as string, structuredClone(v));
  }
  async delete(key: string | string[]) {
    for (const k of Array.isArray(key) ? key : [key]) this.data.delete(k);
  }
  async list({ prefix = "", limit = Infinity } = {}) {
    return structuredClone(
      new Map([...this.data].filter(([k]) => k.startsWith(prefix)).slice(0, limit))
    );
  }
  async setAlarm(value: number) {
    this.alarm = value;
  }
  async deleteAlarm() {
    this.alarm = null;
  }
  async transaction<T>(fn: (tx: Storage) => Promise<T>): Promise<T> {
    const before = this.tail;
    let unlock!: () => void;
    this.tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await before;
    const backup = structuredClone(this.data),
      alarm = this.alarm;
    try {
      return await fn(this);
    } catch (error) {
      this.data = backup;
      this.alarm = alarm;
      throw error;
    } finally {
      unlock();
    }
  }
}
async function create(storage = new Storage()) {
  let ready = Promise.resolve();
  const store = new FinanceStore({
    storage,
    blockConcurrencyWhile: (fn: () => Promise<void>) => {
      ready = fn();
    }
  } as unknown as DurableObjectState);
  await ready;
  return { store, storage };
}
const request = (store: FinanceStore, ticker: string, client = "192.0.2.1") =>
  store.fetch(
    new Request(`https://internal/companies/${ticker}/refresh`, {
      method: "POST",
      headers: { "X-Client-Key": client }
    })
  );
const jobOf = async (response: Response) => ((await response.json()) as { job: FinanceJob }).job;
const read = async (store: FinanceStore, path: string) =>
  (await store.fetch(new Request(`https://internal${path}`))).json();

const mcdAccession = "0000063908-26-000073";
const mcdSource =
  "https://www.sec.gov/Archives/edgar/data/63908/000006390826000073/mcd-20260630.htm";
const mcdInline = readFileSync(
  new URL("./fixtures/finance/mcd-2026-q2-business.html", import.meta.url),
  "utf8"
);
// A single actual Company Facts period from the same filing as the inline fixture.
// Its custom pretax concept is absent from Company Facts; no value is inferred.
const mcdFacts = {
  cik: 63908,
  entityName: "MCDONALDS CORP",
  facts: {
    "us-gaap": Object.fromEntries(
      Object.entries({
        Revenues: 7099000000,
        CostOfGoodsAndServicesSold: 680000000,
        CostsAndExpenses: 3760000000,
        OperatingIncomeLoss: 3338000000,
        IncomeTaxExpenseBenefit: 574000000,
        NetIncomeLoss: 2362000000
      }).map(([tag, val]) => [
        tag,
        {
          label: tag,
          units: {
            USD: [
              {
                start: "2026-04-01",
                end: "2026-06-30",
                val,
                accn: mcdAccession,
                fy: 2026,
                fp: "Q2",
                form: "10-Q",
                filed: "2026-08-07"
              }
            ]
          }
        }
      ])
    )
  }
};
function mcdFetcher(inlineStatus = 200) {
  return vi.fn(async (url: string) => {
    if (url === "https://data.sec.gov/submissions/CIK0000063908.json")
      return Response.json({
        cik: "0000063908",
        tickers: ["MCD"],
        sic: "5812",
        filings: {
          recent: {
            accessionNumber: [mcdAccession],
            filingDate: ["2026-08-07"],
            reportDate: ["2026-06-30"],
            form: ["10-Q"],
            primaryDocument: ["mcd-20260630.htm"]
          },
          files: []
        }
      });
    if (url === "https://data.sec.gov/api/xbrl/companyfacts/CIK0000063908.json")
      return Response.json(mcdFacts);
    if (url === mcdSource)
      return new Response(inlineStatus === 200 ? mcdInline : "Forbidden", {
        status: inlineStatus
      });
    throw new Error(`Unexpected fixture request: ${url}`);
  });
}
async function nextQueueStep(store: FinanceStore) {
  vi.setSystemTime(Date.now() + 600);
  await store.alarm();
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("persistent public finance queue", () => {
  it.each([false, true])(
    "imports ARE's original direct net-income ledger (empty Company Facts: %s)",
    async (empty) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
      const { store, storage } = await create();
      const annual = reviewedFixture("AREDirectNetAnnual"),
        quarter = reviewedFixture("AREDirectNetQuarter");
      const sources = [quarter, annual];
      const standards: Record<string, { label: string; units: { USD: object[] } }> = {};
      for (const s of sources)
        for (const f of parseInlineXbrl(s.html).facts) {
          if (
            !f.tag.startsWith("us-gaap:") ||
            Object.keys(f.context.dimensions).length ||
            f.currency !== "USD" ||
            f.context.start !== s.period.startDate ||
            f.context.end !== s.period.endDate
          )
            continue;
          const key = f.tag.slice(8);
          const concept = (standards[key] ??= { label: f.tag, units: { USD: [] } });
          concept.units.USD.push({
            start: f.context.start,
            end: f.context.end,
            val: f.value,
            accn: s.filing.accession,
            fy: s.period.fiscalYear,
            fp: s.period.kind === "annual" ? "FY" : "Q2",
            form: s.filing.form,
            filed: s.filing.filedAt
          });
        }
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url === "https://data.sec.gov/submissions/CIK0001035443.json")
            return Response.json({
              cik: "0001035443",
              tickers: ["ARE"],
              sic: "6798",
              filings: {
                recent: {
                  accessionNumber: sources.map((s) => s.filing.accession),
                  filingDate: sources.map((s) => s.filing.filedAt),
                  reportDate: sources.map((s) => s.filing.reportDate),
                  form: sources.map((s) => s.filing.form),
                  primaryDocument: sources.map((s) => s.filing.primaryDocument)
                },
                files: []
              }
            });
          if (url === "https://data.sec.gov/api/xbrl/companyfacts/CIK0001035443.json")
            return Response.json({
              cik: 1035443,
              entityName: annual.identity.name,
              facts: { "us-gaap": empty ? {} : standards }
            });
          const source = sources.find((s) => s.filing.sourceUrl === url);
          if (source) return new Response(source.html);
          throw new Error(`Unexpected ARE fixture request: ${url}`);
        })
      );
      const job = await jobOf(await request(store, "ARE"));
      for (let i = 0; i < 12; i++) await nextQueueStep(store);
      const result = (await read(store, "/companies/ARE")) as { company: CompanyV2 };
      for (const s of sources) {
        const p = result.company[s.period.kind].find((p) => p.id === s.period.id)!;
        expect(p.coverage).toEqual({ basics: true, segments: true, sankey: true });
        expect(p.metrics).toEqual(s.period.metrics);
        expect(p.directNetItems).toEqual(s.period.directNetItems);
        expect(p.shareholderBridge).toEqual(s.period.shareholderBridge);
        expect(p.segments?.map((s) => s.revenue)).toEqual(s.period.segments?.map((s) => s.revenue));
        expect(await storage.get(`generic:v24:0001035443:${s.filing.accession}`)).toMatchObject([
          { directNetItems: { ruleId: "are-direct-net-v1" } }
        ]);
      }
      expect(await storage.get(`basic-periods:${job.id}`)).toBeUndefined();
      expect((await read(store, `/jobs/${job.id}`)) as FinanceJob).toMatchObject({
        state: "partial"
      });
    }
  );
  for (const [ticker, annualKey, quarterKey] of [
    ["SPGI", "SPGISubtotalsAnnual", "SPGISubtotalsQuarter"],
    ["CARR", "CARRSubtotalsAnnual", "CARRSubtotalsQuarter"],
    ["PLD", "PLDSubtotalsAnnual", "PLDSubtotalsQuarter"],
    ["MDLZ", "MDLZTransactionFY2025", "MDLZTransaction2026Q2"],
    ["FLEX", "FLEXGrossOperatingFY2026", "FLEXGrossOperating2027Q1"],
    ["DLR", "DLROperatingNetFY2025", "DLROperatingNet2026Q2"],
    ["APH", "APHExternalAnnual", "APHExternalQuarterly"],
    ["IEX", "IEXExternalAnnual", "IEXExternalQuarterly"],
    ["ABBV", "ABBVProductFY2025", "ABBVProduct2026Q2"],
    ["AKAM", "AKAMServicesFY2025", "AKAMServices2026Q2"]
  ] as const)
    it.each([false, true])(
      `imports ${ticker} reviewed primary statement chain (empty Company Facts: %s)`,
      async (empty) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
        const { store, storage } = await create();
        const annual = reviewedFixture(annualKey),
          quarter = reviewedFixture(quarterKey);
        const sources = [quarter, annual];
        const standards: Record<string, { label: string; units: { USD: object[] } }> = {};
        for (const s of sources)
          for (const f of parseInlineXbrl(s.html).facts) {
            if (
              !f.tag.startsWith("us-gaap:") ||
              Object.keys(f.context.dimensions).length ||
              f.currency !== "USD" ||
              f.context.start !== s.period.startDate ||
              f.context.end !== s.period.endDate
            )
              continue;
            const key = f.tag.slice(8);
            const concept = (standards[key] ??= { label: f.tag, units: { USD: [] } });
            concept.units.USD.push({
              start: f.context.start,
              end: f.context.end,
              val: f.value,
              accn: s.filing.accession,
              fy: s.period.fiscalYear,
              fp: s.period.kind === "annual" ? "FY" : `Q${s.period.fiscalQuarter}`,
              form: s.filing.form,
              filed: s.filing.filedAt
            });
          }
        vi.stubGlobal(
          "fetch",
          vi.fn(async (url: string) => {
            if (url === `https://data.sec.gov/submissions/CIK${annual.identity.cik}.json`)
              return Response.json({
                cik: annual.identity.cik,
                tickers: [ticker],
                sic: {
                  SPGI: "7320",
                  CARR: "3585",
                  PLD: "6798",
                  MDLZ: "2000",
                  FLEX: "3672",
                  DLR: "6798",
                  APH: "3678",
                  IEX: "3561",
                  ABBV: "2834",
                  AKAM: "7370"
                }[ticker],
                filings: {
                  recent: {
                    accessionNumber: sources.map((s) => s.filing.accession),
                    filingDate: sources.map((s) => s.filing.filedAt),
                    reportDate: sources.map((s) => s.filing.reportDate),
                    form: sources.map((s) => s.filing.form),
                    primaryDocument: sources.map((s) => s.filing.primaryDocument)
                  },
                  files: []
                }
              });
            if (url === `https://data.sec.gov/api/xbrl/companyfacts/CIK${annual.identity.cik}.json`)
              return Response.json({
                cik: Number(annual.identity.cik),
                entityName: annual.identity.name,
                facts: { "us-gaap": empty ? {} : standards }
              });
            const source = sources.find((s) => s.filing.sourceUrl === url);
            if (source) return new Response(source.html);
            throw new Error(`Unexpected operating-subtotal fixture request: ${url}`);
          })
        );
        const job = await jobOf(await request(store, ticker));
        for (let i = 0; i < 12; i++) await nextQueueStep(store);
        const result = (await read(store, `/companies/${ticker}`)) as { company: CompanyV2 };
        for (const s of sources) {
          const p = result.company[s.period.kind].find((p) => p.id === s.period.id)!;
          expect(p.coverage).toEqual({ basics: true, segments: true, sankey: true });
          for (const metric of [
            "revenue",
            "totalOperatingCosts",
            "operatingIncome",
            "pretaxIncome",
            "incomeTax",
            "netIncome"
          ] as const)
            expect(p.metrics[metric]).toBe(s.period.metrics[metric]);
          if (s.period.operatingItems) {
            const expected = structuredClone(s.period.operatingItems);
            if (empty) delete expected.excludedSegmentExpenses;
            expect(p.operatingItems).toEqual(expected);
          }
          if (s.period.afterTaxTransactionItems) {
            expect(p.afterTaxTransactionItems).toEqual(s.period.afterTaxTransactionItems);
            expect(p.metrics.afterTaxTransactionIncome).toBe(
              s.period.metrics.afterTaxTransactionIncome
            );
            expect(p.metrics.equityMethodIncome).toBe(s.period.metrics.equityMethodIncome);
          }
          if (s.period.grossOperatingItems) {
            expect(p.grossOperatingItems).toEqual(s.period.grossOperatingItems);
            expect(p.grossProfitAdjustments).toEqual(s.period.grossProfitAdjustments);
            expect(p.metrics.costOfRevenue).toBe(s.period.metrics.costOfRevenue);
            expect(p.metrics.operatingExpenses).toBe(s.period.metrics.operatingExpenses);
          }
          if (s.period.operatingNetItems) {
            expect(p.operatingNetItems).toEqual(s.period.operatingNetItems);
            expect(p.shareholderBridge).toEqual(s.period.shareholderBridge);
          }
          expect(p.segments?.map((s) => s.revenue)).toEqual(
            s.period.segments?.map((s) => s.revenue)
          );
          if (ticker === "ABBV" || ticker === "AKAM") {
            expect(p.segments).toEqual(s.period.segments);
            expect(p.businessBreakdownSource).toEqual(s.period.businessBreakdownSource);
          }
          expect(
            await storage.get(`generic:v24:${annual.identity.cik}:${s.filing.accession}`)
          ).toMatchObject([
            s.period.operatingItems
              ? { operatingItems: { ruleId: s.period.operatingItems.ruleId } }
              : s.period.grossOperatingItems
                ? { grossOperatingItems: { ruleId: s.period.grossOperatingItems.ruleId } }
                : s.period.operatingNetItems
                  ? { operatingNetItems: { ruleId: s.period.operatingNetItems.ruleId } }
                  : s.period.afterTaxTransactionItems
                    ? {
                        afterTaxTransactionItems: {
                          ruleId: s.period.afterTaxTransactionItems!.ruleId
                        }
                      }
                    : {
                        businessBreakdownSource: {
                          method: s.period.businessBreakdownSource!.method
                        }
                      }
          ]);
        }
        expect(await storage.get(`basic-periods:${job.id}`)).toBeUndefined();
        expect((await read(store, `/jobs/${job.id}`)) as FinanceJob).toMatchObject({
          state: "partial"
        });
      }
    );
  it.each([false, true])(
    "imports source-current Abbott business revenue when Company Facts is lagging (empty: %s)",
    async (empty) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
      const { store, storage } = await create();
      const annual = reviewedFixture("ABTAnnual");
      const quarter = reviewedFixture("ABT");
      const standards = Object.fromEntries(
        parseInlineXbrl(annual.html)
          .facts.filter(
            (f) =>
              f.tag.startsWith("us-gaap:") &&
              f.context.start === "2025-01-01" &&
              f.context.end === "2025-12-31" &&
              !Object.keys(f.context.dimensions).length
          )
          .map((f) => [
            f.tag.slice(8),
            {
              label: f.tag,
              units: {
                USD: [
                  {
                    start: "2025-01-01",
                    end: "2025-12-31",
                    val: f.value,
                    accn: annual.filing.accession,
                    fy: 2025,
                    fp: "FY",
                    form: "10-K",
                    filed: annual.filing.filedAt
                  }
                ]
              }
            }
          ])
      );
      const sources = [quarter, annual];
      const fetcher = vi.fn(async (url: string) => {
        if (url === "https://data.sec.gov/submissions/CIK0000001800.json")
          return Response.json({
            cik: "0000001800",
            tickers: ["ABT"],
            sic: "2834",
            filings: {
              recent: {
                accessionNumber: sources.map((s) => s.filing.accession),
                filingDate: sources.map((s) => s.filing.filedAt),
                reportDate: sources.map((s) => s.filing.reportDate),
                form: sources.map((s) => s.filing.form),
                primaryDocument: sources.map((s) => s.filing.primaryDocument)
              },
              files: []
            }
          });
        if (url === "https://data.sec.gov/api/xbrl/companyfacts/CIK0000001800.json")
          return Response.json({
            cik: 1800,
            entityName: "Abbott",
            facts: { "us-gaap": empty ? {} : standards }
          });
        const source = sources.find((s) => s.filing.sourceUrl === url);
        if (source) return new Response(source.html);
        throw new Error(`Unexpected Abbott fixture request: ${url}`);
      });
      vi.stubGlobal("fetch", fetcher);
      const job = await jobOf(await request(store, "ABT"));
      await nextQueueStep(store);
      await nextQueueStep(store);
      const before = (await read(store, "/companies/ABT")) as { company: CompanyV2 | null };
      if (empty) expect(before.company).toBeNull();
      else expect(before.company?.quarterly).toEqual([]);
      for (let i = 0; i < 5; i++) await nextQueueStep(store);
      const result = (await read(store, "/companies/ABT")) as { company: CompanyV2 };
      const q = result.company.quarterly[0];
      expect(q.id).toBe("2026-Q2");
      expect(q.coverage).toEqual({ basics: true, sankey: true, segments: true });
      expect(q.metrics.revenue).toBe(12593e6);
      expect(q.segments?.map((s) => s.revenue)).toEqual([1499e6, 2144e6, 3092e6, 5853e6, 5e6]);
      expect(result.company.annual[0].coverage).toEqual({
        basics: true,
        sankey: true,
        segments: true
      });
      expect(result.company.warnings.some((w) => w.startsWith("SEC lists a report ending"))).toBe(
        false
      );
      expect(await storage.get(`generic:v24:0000001800:${quarter.filing.accession}`)).toMatchObject(
        [{ id: "2026-Q2", coverage: { segments: true } }]
      );
      expect(await storage.get(`basic-periods:${job.id}`)).toBeUndefined();
      expect((await read(store, `/jobs/${job.id}`)) as FinanceJob).toMatchObject({
        state: "partial"
      });
    }
  );
  it("enriches an unbundled MCD filing and retains its reported flow through an engine-upgrade refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    const { store, storage } = await create();
    expect(await read(store, "/companies/MCD")).toMatchObject({ company: null });
    const fetcher = mcdFetcher();
    vi.stubGlobal("fetch", fetcher);
    const first = await jobOf(await request(store, "MCD"));
    expect(await storage.get(`task:${first.id}`)).toMatchObject({
      engineVersion: "finance-v2.36"
    });
    await nextQueueStep(store);
    await nextQueueStep(store);
    const basic = (await read(store, "/companies/MCD")) as { company: CompanyV2 };
    expect(basic.company.quarterly).toHaveLength(1);
    expect(basic.company.quarterly[0].coverage.sankey).toBe(false);
    expect(basic.company.quarterly[0].metrics.pretaxIncome).toBeUndefined();
    expect(basic.company.quarterly[0].metrics.grossProfit).toBeUndefined();
    expect(await storage.get(`task:${first.id}`)).toMatchObject({
      stage: "filings",
      todo: [{ accession: mcdAccession, sourceUrl: mcdSource }],
      cursor: 0
    });
    await nextQueueStep(store);
    const enriched = (await read(store, "/companies/MCD")) as { company: CompanyV2 };
    const period = enriched.company.quarterly[0];
    expect(period.coverage).toMatchObject({ basics: true, sankey: true, segments: true });
    expect(period.segments?.map((segment) => segment.revenue)).toEqual([4393e6, 2525e6, 182e6]);
    expect(period.revenueAdjustments).toEqual([
      { id: "source-rounding", label: "Source rounding", revenue: -1e6 }
    ]);
    expect(await storage.get(`generic:v24:0000063908:${mcdAccession}`)).toMatchObject([
      { coverage: { segments: true, sankey: true } }
    ]);
    expect(await storage.get(`basic-periods:${first.id}`)).toBeUndefined();
    expect(period.metrics).toMatchObject({
      ...basic.company.quarterly[0].metrics,
      revenue: 7099000000,
      totalOperatingCosts: 3760000000,
      operatingIncome: 3338000000,
      pretaxIncome: 2936000000,
      incomeTax: 574000000,
      netIncome: 2362000000
    });
    expect(period.metrics.grossProfit).toBeUndefined();
    expect(period.metricSources.pretaxIncome).toMatchObject({
      tag: "mcd:IncomeLossFromContinuingOperationsBeforeIncomeTaxes",
      method: "reported",
      accession: mcdAccession,
      sourceUrl: mcdSource,
      decimals: -6
    });
    expect(period.metricSources.totalOperatingCosts).toMatchObject({
      tag: "us-gaap:CostsAndExpenses",
      method: "reported",
      decimals: -6
    });
    expect(period.metricSources.operatingIncome?.decimals).toBe(-5);
    expect(period.operatingReconciliation).toEqual({
      label: "Source rounding",
      amount: -1000000,
      sourceUrl: mcdSource
    });
    expect(await read(store, `/jobs/${first.id}`)).toMatchObject({ state: "partial" });
    expect(await storage.get(`company:0000063908`)).toMatchObject({ quarterly: [period] });

    // The completed v2.10 job must not suppress a refresh after deployment.
    const priorTask = (await storage.get(`task:${first.id}`)) as Record<string, unknown>;
    await storage.put(`task:${first.id}`, { ...priorTask, engineVersion: "finance-v2.10" });
    const refreshed = await request(store, "MCD");
    expect(refreshed.status).toBe(202);
    const second = await jobOf(refreshed);
    expect(second.id).not.toBe(first.id);
    await nextQueueStep(store);
    await nextQueueStep(store);
    const after = (await read(store, "/companies/MCD")) as { company: CompanyV2 };
    expect(after.company.quarterly).toEqual(enriched.company.quarterly);
    expect(after.company.version).toBe(enriched.company.version);
    expect(await read(store, `/jobs/${second.id}`)).toMatchObject({ state: "partial" });
    expect(fetcher.mock.calls.filter(([url]) => url === mcdSource)).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it("keeps a prior business breakdown available while enriching newer source candidates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    const { store, storage } = await create();
    // A synthetic earlier filing timestamp isolates the merge rule. Financial
    // amounts and branches remain the real source-derived fixture values.
    const prior = JSON.parse(
      JSON.stringify(businessFixture("MCD").company).replaceAll("2026-08-07", "2026-08-06")
    ) as CompanyV2;
    await storage.put("company:0000063908", prior);
    const fetcher = mcdFetcher();
    vi.stubGlobal("fetch", fetcher);
    const job = await jobOf(await request(store, "MCD"));
    await nextQueueStep(store);
    await nextQueueStep(store);
    const basic = (await read(store, "/companies/MCD")) as { company: CompanyV2 };
    expect(basic.company.quarterly[0].filedAt).toBe("2026-08-06");
    expect(basic.company.quarterly[0].coverage.segments).toBe(true);
    expect(await storage.get(`task:${job.id}`)).toMatchObject({
      stage: "filings",
      todo: [{ accession: mcdAccession }]
    });
    await nextQueueStep(store);
    const after = (await read(store, "/companies/MCD")) as { company: CompanyV2 };
    expect(after.company.quarterly[0].filedAt).toBe("2026-08-07");
    expect(after.company.quarterly[0].coverage).toEqual({
      basics: true,
      segments: true,
      sankey: true
    });
    expect(after.company.quarterly[0].segments?.map((segment) => segment.revenue)).toEqual([
      4393e6, 2525e6, 182e6
    ]);
    expect(fetcher.mock.calls.filter(([url]) => url === mcdSource)).toHaveLength(1);
    expect(await storage.get(`basic-periods:${job.id}`)).toBeUndefined();
  });
  it.each([429, 503])(
    "retries a transient inline source HTTP %s without advancing or discarding data",
    async (status) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
      const { store, storage } = await create();
      const successful = mcdFetcher();
      let sourceCalls = 0;
      const fetcher = vi.fn(async (url: string) => {
        if (url === mcdSource && ++sourceCalls === 1) return new Response("Temporary", { status });
        return successful(url);
      });
      vi.stubGlobal("fetch", fetcher);
      const job = await jobOf(await request(store, "MCD"));
      await nextQueueStep(store);
      await nextQueueStep(store);
      const before = (await read(store, "/companies/MCD")) as { company: CompanyV2 };
      await nextQueueStep(store);
      const waiting = (await read(store, `/jobs/${job.id}`)) as FinanceJob;
      expect(waiting.state).toBe("backfilling");
      expect(waiting.retryAt).toBeDefined();
      expect(await storage.get(`task:${job.id}`)).toMatchObject({ cursor: 0, attempts: 1 });
      expect((await read(store, "/companies/MCD")) as { company: CompanyV2 }).toMatchObject({
        company: { quarterly: before.company.quarterly }
      });
      await nextQueueStep(store);
      expect(sourceCalls).toBe(1);
      vi.setSystemTime(new Date(waiting.retryAt!));
      await nextQueueStep(store);
      const after = (await read(store, "/companies/MCD")) as { company: CompanyV2 };
      expect(after.company.quarterly[0].coverage).toEqual({
        basics: true,
        segments: true,
        sankey: true
      });
      expect(after.company.warnings.some((w) => w.includes(`HTTP ${status}`))).toBe(false);
      expect(sourceCalls).toBe(2);
      const completed = (await read(store, `/jobs/${job.id}`)) as FinanceJob;
      expect(completed.state).toBe("partial");
      expect(completed.retryAt).toBeUndefined();
    }
  );
  it("bounds persistent inline-source retries and retains a truthful gap after exhaustion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    const { store, storage } = await create();
    const fetcher = mcdFetcher(429);
    vi.stubGlobal("fetch", fetcher);
    const job = await jobOf(await request(store, "MCD"));
    await nextQueueStep(store);
    await nextQueueStep(store);
    const before = (await read(store, "/companies/MCD")) as { company: CompanyV2 };
    for (let attempt = 0; attempt < 3; attempt++) {
      await nextQueueStep(store);
      const current = (await read(store, `/jobs/${job.id}`)) as FinanceJob;
      if (attempt < 2) vi.setSystemTime(new Date(current.retryAt!));
      else expect(current.state).toBe("partial");
    }
    const after = (await read(store, "/companies/MCD")) as { company: CompanyV2 };
    expect(after.company.quarterly).toEqual(before.company.quarterly);
    expect(after.company.warnings).toContain("2026-06-30: Source HTTP 429");
    expect(fetcher.mock.calls.filter(([url]) => url === mcdSource)).toHaveLength(3);
    expect(storage.data.get("queue")).toEqual([]);
  });
  it("retains newly imported MCD basic history when the inline filing is unavailable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    const { store, storage } = await create();
    const fetcher = mcdFetcher(403);
    vi.stubGlobal("fetch", fetcher);
    const job = await jobOf(await request(store, "MCD"));
    await nextQueueStep(store);
    await nextQueueStep(store);
    const before = (await read(store, "/companies/MCD")) as { company: CompanyV2 };
    expect(before.company.quarterly[0].metrics.netIncome).toBe(2362000000);
    await nextQueueStep(store);
    const after = (await read(store, "/companies/MCD")) as { company: CompanyV2 };
    expect(after.company.quarterly).toEqual(before.company.quarterly);
    expect(after.company.quarterly[0].coverage.sankey).toBe(false);
    expect(after.company.quarterly[0].metrics.pretaxIncome).toBeUndefined();
    expect(after.company.warnings).toContain("2026-06-30: Source HTTP 403");
    expect(await read(store, `/jobs/${job.id}`)).toMatchObject({ state: "partial" });
    expect(storage.data.get("queue")).toEqual([]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://data.sec.gov/submissions/CIK0000063908.json",
      "https://data.sec.gov/api/xbrl/companyfacts/CIK0000063908.json",
      mcdSource
    ]);
  });
  it("does not resurrect unreviewed gross profit when filling a short stored history from the bundle", async () => {
    const { store, storage } = await create();
    const original = history.companies.find((company) => company.ticker === "GOOGL")! as CompanyV2;
    const prior = structuredClone({ ...original, annual: original.annual.slice(0, -1) });
    const unreviewed = prior.annual.find(
      (period) => period.metricSources.grossProfit?.tag === "revenue - costOfRevenue"
    )!;
    expect(unreviewed.metrics.grossProfit).toBeTypeOf("number");
    await storage.put(`company:${original.cik}`, prior);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = (await read(store, "/companies/GOOGL")) as { company: CompanyV2 };
    expect(response.company.annual).toHaveLength(original.annual.length);
    const fixed = response.company.annual.find((period) => period.id === unreviewed.id)!;
    expect(fixed.metrics.grossProfit).toBeUndefined();
    expect(fixed.metrics.operatingExpenses).toBeUndefined();
    expect(fixed.coverage.sankey).toBe(false);
    expect(fixed.metrics.revenue).toBe(unreviewed.metrics.revenue);
    for (const kind of ["annual", "quarterly"] as const)
      for (const period of original[kind].filter((p) => p.coverage.segments))
        expect(response.company[kind].find((p) => p.id === period.id)).toEqual(period);
    expect(await storage.get(`company:${original.cik}`)).toEqual(prior);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("withholds old inferred gross profit on reads without crawling or rewriting the saved source", async () => {
    const { store, storage } = await create();
    const original = imported.companies.find((company) => company.ticker === "MCD")!;
    await storage.put(`company:${original.cik}`, original);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = (await read(store, "/companies/MCD")) as { company: CompanyV2 };
    expect(response.company.quarterly.at(-1)!.metrics.grossProfit).toBeUndefined();
    expect(response.company.quarterly.at(-1)!.metrics.netIncome).toBe(2362000000);
    expect(response.company.version).toMatch(/-scope2$/);
    expect(await storage.get(`company:${original.cik}`)).toEqual(original);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("restores a verified business breakdown hidden by a complete older basic-only history", async () => {
    const { store, storage } = await create();
    const identity = catalogIdentity("AMZN")!;
    const full = structuredClone(bundledCompany(identity)!);
    const prior = structuredClone(full);
    for (const period of [...prior.annual, ...prior.quarterly]) {
      delete period.segments;
      delete period.segmentSourceUrl;
      delete period.segmentBasis;
      delete period.revenueAdjustments;
      period.coverage.segments = false;
      period.coverage.sankey = false;
    }
    await storage.put(`company:${identity.cik}`, prior);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = (await read(store, "/companies/AMZN")) as { company: CompanyV2 };
    expect(result.company.annual).toEqual(full.annual);
    expect(result.company.quarterly).toEqual(full.quarterly);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await storage.get(`company:${identity.cik}`)).toEqual(prior);
  });
  it("keeps newly verified business margins visible over a full older stored history without crawling", async () => {
    const { store, storage } = await create();
    const identity = catalogIdentity("MSFT")!;
    const full = structuredClone(bundledCompany(identity)!);
    expect(full.annual.at(-1)!.segments!.some((segment) => segment.grossProfit !== undefined)).toBe(
      true
    );
    const prior = structuredClone(full);
    for (const period of [...prior.annual, ...prior.quarterly]) {
      for (const segment of period.segments ?? []) {
        delete segment.grossProfit;
        delete segment.grossProfitSource;
      }
    }
    await storage.put(`company:${identity.cik}`, prior);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = (await read(store, "/companies/MSFT")) as { company: CompanyV2 };
    expect(result.company.annual).toEqual(full.annual);
    expect(result.company.quarterly).toEqual(full.quarterly);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await storage.get(`company:${identity.cik}`)).toEqual(prior);
  });
  it("keeps a deployed historical backfill visible over an older short stored snapshot without crawling", async () => {
    const { store, storage } = await create();
    const identity = catalogIdentity("MSFT")!;
    const full = structuredClone(bundledCompany(identity)!);
    const short = { ...full, annual: full.annual.slice(-3), quarterly: full.quarterly.slice(-6) };
    await storage.put(`company:${identity.cik}`, short);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = (await read(store, "/companies/MSFT")) as { company: CompanyV2 };
    expect(result.company.annual).toEqual(full.annual);
    expect(result.company.quarterly).toEqual(full.quarterly);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await storage.get(`company:${identity.cik}`)).toEqual(short);
  });
  it("reserves read capacity when the daily background-work budget is exhausted", async () => {
    const { store, storage } = await create();
    const job = await jobOf(await request(store, "AAPL"));
    await storage.put(`quota:work:${Math.floor(Date.now() / 86400000)}`, 4000);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await store.alarm();
    expect(await read(store, `/jobs/${job.id}`)).toMatchObject({
      state: "queued",
      completed: 0,
      retryAt: expect.any(String)
    });
    expect((await request(store, "WMT")).status).toBe(429);
    expect(await read(store, "/companies/AAPL")).toMatchObject({ company: { ticker: "AAPL" } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("coalesces simultaneous and multi-ticker requests by CIK, not ticker or visitor", async () => {
    const { store, storage } = await create();
    const jobs = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        request(store, i % 2 ? "GOOG" : "GOOGL", `192.0.2.${i}`).then(jobOf)
      )
    );
    expect(new Set(jobs.map((j) => j.id)).size).toBe(1);
    expect(storage.data.get("queue")).toEqual([jobs[0].id]);
    expect([...storage.data.keys()].filter((k) => k.startsWith("quota:ip:")).length).toBe(1);
    expect(JSON.stringify([...storage.data])).not.toContain("192.0.2.");
  });
  it("limits each visitor to five new jobs per hour, while repeats and reads remain usable", async () => {
    const { store } = await create();
    for (const ticker of ["AAPL", "MSFT", "NVDA", "AMZN", "META"])
      expect((await request(store, ticker)).status).toBe(202);
    const limited = await request(store, "WMT");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await request(store, "AAPL")).status).toBe(202);
    expect(await read(store, "/companies/AAPL")).toMatchObject({ company: { ticker: "AAPL" } });
  });
  it("stops new imports at twenty daily without consuming the separate update allowance", async () => {
    const { store } = await create();
    const existing = new Set(["AAPL", "MSFT", "GOOG", "GOOGL", "NVDA", "AMZN", "META", "TSM"]);
    const candidates = [
      ...new Map(
        catalog.companies.filter((c) => !existing.has(c.ticker)).map((c) => [c.cik, c])
      ).values()
    ].slice(0, 21);
    for (let i = 0; i < candidates.length; i++)
      expect((await request(store, candidates[i].ticker, `192.0.2.${i}`)).status).toBe(
        i < 20 ? 202 : 429
      );
    expect((await request(store, "AAPL", "192.0.2.100")).status).toBe(202);
  });
  it("enforces the daily update cap without blocking saved data", async () => {
    const { store, storage } = await create();
    await storage.put(`quota:day:${Math.floor(Date.now() / 86400000)}`, {
      imports: 0,
      updates: 100
    });
    expect((await request(store, "AAPL")).status).toBe(429);
    expect((await request(store, "WMT")).status).toBe(202);
    expect(await read(store, "/companies/AAPL")).toMatchObject({ company: { ticker: "AAPL" } });
  });
  it("survives object restart and retains all verified data when SEC returns 403", async () => {
    const { store, storage } = await create();
    const before = (await read(store, "/companies/AAPL")) as { company: unknown };
    const job = await jobOf(await request(store, "AAPL"));
    const resumed = await create(storage);
    const fetcher = vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }));
    vi.stubGlobal("fetch", fetcher);
    await resumed.store.alarm();
    expect(await read(resumed.store, `/jobs/${job.id}`)).toMatchObject({ state: "failed" });
    expect(await read(resumed.store, "/companies/AAPL")).toMatchObject({ company: before.company });
    expect(storage.data.get("queue")).toEqual([]);
    expect(storage.alarm).toBeNull();
    expect(fetcher.mock.calls[0][1].redirect).toBe("manual");
    expect(fetcher.mock.calls[0][1].headers["User-Agent"]).toContain("swan0624@uw.edu");
    expect((await request(resumed.store, "AAPL")).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rotates backfills fairly and does not retry a throttled source before retryAt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00Z"));
    const { store, storage } = await create();
    const first = await jobOf(await request(store, "WMT"));
    const second = await jobOf(await request(store, "JPM"));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(
        Response.json({
          cik: catalogIdentity("JPM")!.cik,
          tickers: ["JPM"],
          filings: { recent: { accessionNumber: [] }, files: [] }
        })
      );
    vi.stubGlobal("fetch", fetcher);
    await store.alarm();
    expect(storage.data.get("queue")).toEqual([second.id, first.id]);
    vi.setSystemTime(Date.now() + 600);
    await store.alarm();
    expect(await read(store, `/jobs/${second.id}`)).toMatchObject({
      state: "fetching",
      completed: 1
    });
    expect(await read(store, `/jobs/${first.id}`)).toMatchObject({
      completed: 0,
      retryAt: "2026-09-04T12:00:30.000Z"
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rolls back a failed publication transaction", async () => {
    const { store, storage } = await create();
    const original = bundledCompany(catalogIdentity("AAPL")!)!;
    const key = `company:${original.cik}`;
    await storage.put(key, original);
    const put = storage.put.bind(storage);
    vi.spyOn(storage, "put").mockImplementation(async (key, value) => {
      if (key === "index") throw new Error("disk full");
      return put(key, value);
    });
    // Exercise the actual merge/validate/publication boundary, injecting a fault
    // after the company row is written but before the index transaction commits.
    const publish = Reflect.get(store, "publish") as (
      task: { job: { ticker: string }; changed: boolean },
      incoming: CompanyV2
    ) => Promise<void>;
    await expect(
      publish.call(store, { job: { ticker: "AAPL" }, changed: false }, structuredClone(original))
    ).rejects.toThrow("disk full");
    expect(await storage.get(key)).toEqual(original);
    expect(await storage.get(`previous:${original.cik}`)).toBeUndefined();
    expect(await storage.get("index")).toBeUndefined();
  });
});
