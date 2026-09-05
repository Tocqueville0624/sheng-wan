import { expect, test } from "vitest";
import history from "../src/data/generated/finance-history.json";
import type { FinanceHistory } from "../src/features/finance/v2-types";
import { validateFeaturedHistory } from "../scripts/finance/history";
import { apiV2 } from "../worker/index";

test("every featured company keeps the full validated history even without online storage", async () => {
  const snapshot = history as FinanceHistory;
  validateFeaturedHistory(snapshot);
  for (const company of snapshot.companies) {
    const response = await apiV2(
      new Request(`https://site.test/api/finance/v2/companies/${company.ticker}`),
      {} as never
    );
    expect(await response.json()).toMatchObject({ available: false, job: null, company });
    expect(company.annual).toHaveLength(10);
    expect(company.quarterly).toHaveLength(20);
    expect(
      company.annual.every(
        (p) => p.metrics.revenue !== undefined && p.metrics.netIncome !== undefined
      )
    ).toBe(true);
    expect(
      company.quarterly.every(
        (p) => p.metrics.revenue !== undefined && p.metrics.netIncome !== undefined
      )
    ).toBe(true);
  }
  const incomplete = structuredClone(snapshot);
  incomplete.companies[1].annual = incomplete.companies[1].annual.slice(-3);
  expect(() => validateFeaturedHistory(incomplete)).toThrow(/10 validated annual/);
});
