import { expect, test } from "vitest";
import history from "../src/data/generated/finance-history.json";
import type { CompanyV2, FinanceHistory } from "../src/features/finance/v2-types";
import { validateFeaturedHistory } from "../scripts/finance/history";
import { normalizeBasicCompany, validateV2 } from "../scripts/finance/v2-model";
import { apiV2 } from "../worker/index";

test("every featured company keeps the full validated history even without online storage", async () => {
  const snapshot = history as FinanceHistory;
  const originalSnapshot = structuredClone(snapshot);
  validateFeaturedHistory(snapshot);
  for (const company of snapshot.companies) {
    const response = await apiV2(
      new Request(`https://site.test/api/finance/v2/companies/${company.ticker}`),
      {} as never
    );
    const body = (await response.json()) as { company: CompanyV2 };
    expect(body).toMatchObject({
      available: false,
      job: null,
      company: normalizeBasicCompany(company)
    });
    const served = body.company;
    expect(() => validateV2(served)).not.toThrow();
    expect(served.annual).toHaveLength(10);
    expect(served.quarterly).toHaveLength(20);
    expect(
      served.annual.every(
        (p) => p.metrics.revenue !== undefined && p.metrics.netIncome !== undefined
      )
    ).toBe(true);
    expect(
      served.quarterly.every(
        (p) => p.metrics.revenue !== undefined && p.metrics.netIncome !== undefined
      )
    ).toBe(true);
    for (const kind of ["annual", "quarterly"] as const) {
      expect(served[kind].map((period) => period.id)).toEqual(
        company[kind].map((period) => period.id)
      );
      for (const original of company[kind]) {
        const period = served[kind].find((candidate) => candidate.id === original.id)!;
        expect(period).toMatchObject({
          startDate: original.startDate,
          endDate: original.endDate,
          filedAt: original.filedAt,
          accession: original.accession,
          sourceUrl: original.sourceUrl,
          reportingCurrency: original.reportingCurrency,
          displayCurrency: original.displayCurrency
        });
        if (original.coverage.segments) expect(period).toEqual(original);
        for (const [key, source] of Object.entries(original.metricSources)) {
          if (source.method !== "reported") continue;
          const metric = key as keyof typeof original.metrics;
          expect(period.metrics[metric]).toBe(original.metrics[metric]);
          expect(period.metricSources[metric]).toEqual(source);
        }
      }
    }
  }
  expect(snapshot).toEqual(originalSnapshot);
  const incomplete = structuredClone(snapshot);
  incomplete.companies[1].annual = incomplete.companies[1].annual.slice(-3);
  expect(() => validateFeaturedHistory(incomplete)).toThrow(/10 validated annual/);
});
