import { describe, expect, it, vi } from "vitest";
import snapshotData from "../src/data/generated/finance-reviewed/0001103982.json";
import akamaiData from "../src/data/generated/finance-reviewed/0001086222.json";
import albemarleData from "../src/data/generated/finance-reviewed/0000915913.json";
import { catalogIdentity } from "../worker/finance-store";
import { apiV2 } from "../worker/index";
import { reviewedSnapshot, supplementReviewedHistory } from "../worker/reviewed-snapshots";
import { validateV2 } from "../scripts/finance/v2-model";
import type { CompanyV2, PeriodV2, CompanyResponse } from "../src/features/finance/v2-types";

const identity = catalogIdentity("MDLZ")!;
const original = snapshotData as CompanyV2;
function assetResponse(body = JSON.stringify(original), status = 200, type = "application/json") {
  return {
    fetch: vi.fn(async () => new Response(body, { status, headers: { "Content-Type": type } }))
  } as unknown as Fetcher;
}
const companyRequest = new Request("https://shengwan.org/api/finance/v2/companies/MDLZ");

describe("reviewed SEC snapshot delivery", () => {
  it("delivers the actual Albemarle SEC snapshot with distinct 2021/2022 history and explicit remaining gaps", async () => {
    const company = albemarleData as CompanyV2;
    const body = JSON.stringify(company);
    expect(new TextEncoder().encode(body).length).toBeLessThan(1024 * 1024);
    const response = await apiV2(new Request("https://shengwan.org/api/finance/v2/companies/ALB"), {
      ASSETS: assetResponse(body),
      FINANCE_PUBLIC_UPDATES: "disabled"
    });
    const result = (await response.json()) as CompanyResponse;
    expect(result.savedSourceSnapshot!.checkedAt).toBe(company.checkedAt);
    expect(result.job).toBeNull();
    const periods = [...result.company!.annual, ...result.company!.quarterly];
    expect(periods.filter((p) => p.coverage.segments)).toHaveLength(29);
    expect(periods.filter((p) => p.coverage.sankey)).toHaveLength(28);
    expect(periods.filter((p) => !p.coverage.sankey).map((p) => p.id)).toEqual([
      "FY2016",
      "2021-Q2"
    ]);
    expect(result.company!.annual.find((p) => p.id === "FY2021")!.endDate).toBe("2021-12-31");
    expect(result.company!.annual.find((p) => p.id === "FY2022")!.endDate).toBe("2022-12-31");
    for (const kind of ["annual", "quarterly"] as const) {
      const p = result.company![kind].at(-1)!;
      expect(p.coverage).toEqual({ basics: true, segments: true, sankey: true });
      expect(p.businessBreakdownSource!.method).toBe("reviewed-albemarle-revenue");
      expect(p.segments).toEqual(company[kind].at(-1)!.segments);
    }
    expect(() => validateV2(result.company!)).not.toThrow();
  });
  it("delivers the actual Akamai SEC snapshot while retaining the public update quota", async () => {
    const company = akamaiData as CompanyV2;
    const body = JSON.stringify(company);
    expect(new TextEncoder().encode(body).length).toBeLessThan(1024 * 1024);
    const assets = assetResponse(body);
    const storeFetch = vi.fn(async (request: Request) =>
      request.method === "POST"
        ? Response.json(
            { error: { code: "RATE_LIMITED" }, retryAt: "2026-10-07T00:00:00.000Z" },
            { status: 429 }
          )
        : Response.json({ company: null, job: null, available: true })
    );
    const env = {
      ASSETS: assets,
      FINANCE_PUBLIC_UPDATES: "enabled",
      FINANCE_STORE: {
        idFromName: () => "finance-v2",
        get: () => ({ fetch: storeFetch })
      } as unknown as DurableObjectNamespace
    };
    const response = await apiV2(
      new Request("https://shengwan.org/api/finance/v2/companies/AKAM"),
      env
    );
    const result = (await response.json()) as CompanyResponse;
    expect(result.company!.checkedAt).toBe(company.checkedAt);
    expect(result.savedSourceSnapshot!.checkedAt).toBe(company.checkedAt);
    expect(result.job).toBeNull();
    expect(result.company!.annual).toHaveLength(10);
    expect(result.company!.quarterly).toHaveLength(20);
    expect(
      [...result.company!.annual, ...result.company!.quarterly].filter((p) => p.coverage.segments)
    ).toHaveLength(23);
    for (const kind of ["annual", "quarterly"] as const) {
      const p = result.company![kind].at(-1)!;
      expect(p.coverage).toEqual({ basics: true, segments: true, sankey: true });
      expect(p.segments).toEqual(company[kind].at(-1)!.segments);
      expect(p.businessBreakdownSource!.method).toBe("reviewed-service-revenue-rows");
    }
    expect(() => validateV2(result.company!)).not.toThrow();
    const update = await apiV2(
      new Request("https://shengwan.org/api/finance/v2/companies/AKAM/refresh", {
        method: "POST",
        headers: { Origin: "https://shengwan.org" }
      }),
      env
    );
    expect(update.status).toBe(429);
    expect(await update.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(assets.fetch).toHaveBeenCalledTimes(1);
    expect(storeFetch).toHaveBeenCalledTimes(2);
  });
  it("retains the actual 29 reconciled periods and the missing 2020-Q4 source gap", async () => {
    const assets = assetResponse();
    const loaded = await reviewedSnapshot(identity, assets);
    expect(loaded).toBeDefined();
    expect(() => validateV2(loaded!.company)).not.toThrow();
    const periods = [...loaded!.company.annual, ...loaded!.company.quarterly];
    expect(periods.filter((p) => p.coverage.sankey && p.coverage.segments)).toHaveLength(29);
    expect(
      periods.filter((p) => !p.coverage.sankey || !p.coverage.segments).map((p) => p.id)
    ).toEqual(["2020-Q4"]);
    expect(assets.fetch).toHaveBeenCalledTimes(1);
    const request = vi.mocked(assets.fetch).mock.calls[0][0] as Request;
    expect(request.url).toBe("https://finance.internal/data/finance/reviewed/0001103982.json");
    expect(request.headers.has("User-Agent")).toBe(false);
  });

  it.each([
    ["hash mismatch", "{}", 200, "application/json"],
    ["HTML fallback", "<html></html>", 200, "text/html"],
    ["missing asset", "{}", 404, "application/json"],
    ["oversized asset", " ".repeat(1024 * 1024 + 1), 200, "application/json"]
  ])("rejects %s without publishing replacement data", async (_, body, status, type) => {
    const loaded = await reviewedSnapshot(identity, assetResponse(body, status, type));
    expect(loaded).toBeUndefined();
  });

  it("serves checked statement data when storage is unavailable, without advancing source dates", async () => {
    const assets = assetResponse();
    const response = await apiV2(companyRequest, {
      ASSETS: assets,
      FINANCE_PUBLIC_UPDATES: "disabled"
    });
    const body = (await response.json()) as CompanyResponse;
    expect(response.status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.job).toBeNull();
    expect(body.savedSourceSnapshot!.checkedAt).toBe(original.checkedAt);
    expect(body.company!.updatedAt).toBe(original.updatedAt);
    expect(body.company!.quarterly.at(-1)!.id).toBe("2026-Q2");
    expect(body.company!.quarterly.at(-1)!.afterTaxTransactionItems).toEqual(
      original.quarterly.at(-1)!.afterTaxTransactionItems
    );
  });

  it("preserves the real throttled task while supplementing coherent source-backed periods", async () => {
    const p = original.quarterly.at(-1)!;
    const basic: PeriodV2 = {
      id: p.id,
      label: p.label,
      kind: p.kind,
      fiscalYear: p.fiscalYear,
      fiscalQuarter: p.fiscalQuarter,
      startDate: p.startDate,
      endDate: p.endDate,
      accession: p.accession,
      filedAt: p.filedAt,
      sourceUrl: p.sourceUrl,
      reportingCurrency: p.reportingCurrency,
      displayCurrency: p.displayCurrency,
      metrics: { revenue: p.metrics.revenue, netIncome: p.metrics.netIncome },
      metricSources: { revenue: p.metricSources.revenue, netIncome: p.metricSources.netIncome },
      coverage: { basics: true, segments: false, sankey: false },
      derived: false
    };
    const stored = {
      ...original,
      annual: [],
      quarterly: [basic],
      warnings: ["2026-06-30: Source HTTP 429"]
    };
    validateV2(stored);
    const job = {
      state: "backfilling",
      completed: 3,
      total: 28,
      message: "Source temporarily unavailable; retrying without replacing saved data.",
      retryAt: "2026-10-06T09:00:00.000Z"
    };
    const storeFetch = vi.fn(async () =>
      Response.json({ company: stored, job, available: true }, { status: 202 })
    );
    const namespace = {
      idFromName: () => "finance-v2",
      get: () => ({ fetch: storeFetch })
    } as unknown as DurableObjectNamespace;
    const response = await apiV2(companyRequest, {
      ASSETS: assetResponse(),
      FINANCE_STORE: namespace,
      FINANCE_PUBLIC_UPDATES: "enabled"
    });
    const body = (await response.json()) as CompanyResponse;
    expect(response.status).toBe(202);
    expect(body.job).toEqual(job);
    expect(body.available).toBe(true);
    expect(body.company!.warnings).toContain("2026-06-30: Source HTTP 429");
    expect(body.company!.quarterly.at(-1)!.metrics).toEqual(p.metrics);
    expect(body.company!.quarterly.at(-1)!.segments).toEqual(p.segments);
    expect(stored.quarterly[0].coverage.sankey).toBe(false);
    expect(storeFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps newer validated periods and leaves the deployment snapshot immutable", async () => {
    const loaded = (await reviewedSnapshot(identity, assetResponse()))!;
    const earlier = structuredClone(loaded);
    earlier.company.quarterly = earlier.company.quarterly.slice(0, -1);
    const before = JSON.stringify(earlier);
    const merged = await supplementReviewedHistory(original, earlier);
    expect(merged.company.quarterly.at(-1)).toEqual(original.quarterly.at(-1));
    expect(JSON.stringify(earlier)).toBe(before);
  });
});
