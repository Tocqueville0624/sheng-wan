import { describe, expect, it } from "vitest";
import {
  prepareOriginalStandaloneBusinessFiling,
  finishOriginalStandaloneBusinessFiling,
  assertOriginalStandaloneBusinessState
} from "../scripts/finance/standalone-business-state";
import { sourceOnlyFixture } from "./fixtures/finance/standalone-business-fixtures";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { companyFromFilingPeriods } from "../scripts/finance/current-filing";

describe("persistent original standalone acquisition state", () => {
  it.each(["AME", "ALB"] as const)(
    "imports %s with no saved company or Company Facts",
    async (ticker) => {
      const s = await sourceOnlyFixture(ticker);
      const state = await prepareOriginalStandaloneBusinessFiling(
        s.html,
        s.identity,
        s.filing,
        undefined
      );
      expect(state).toBeDefined();
      expect(JSON.stringify(state)).not.toContain("<table");
      expect(JSON.stringify(state)).not.toContain("<xbrl");
      const result = await finishOriginalStandaloneBusinessFiling(
        structuredClone(state!),
        s.xml,
        s.instanceUrl,
        s.identity,
        s.filing,
        undefined
      );
      const p = result.periods.find((p) => p.id === "FY2016")!;
      expect(p).toBeDefined();
      expect(p.segments).toEqual(s.preserved.period.segments);
      expect(p.metrics.revenue).toBe(s.preserved.period.metrics.revenue);
      expect(p.metrics.netIncome).toBe(s.preserved.period.metrics.netIncome);
      expect(p.coverage).toEqual({ basics: true, segments: true, sankey: true });
      expect(businessPeriod(p)).toBeTruthy();
      expect(flowPeriod(p)).toBeTruthy();
      expect(
        Object.entries(p.metricSources)
          .filter(([key]) => key !== "operatingExpenses")
          .every(([, source]) => source?.method === "reported")
      ).toBe(true);
      expect(p.businessBreakdownSource?.standaloneRevenue?.primaryProfile).toBe("income-statement");
      if (ticker === "ALB") {
        expect(p.metrics.operatingExpenses).toBe(369326000);
        expect(p.metricSources.operatingExpenses?.method).toBe("calculated");
        expect(p.metricSources.operatingExpenses?.decimals).toBeUndefined();
        expect(p.metrics.equityMethodIncome).toBe(59637000);
        expect(p.metrics.discontinuedOperationsIncome).toBe(202131000);
      } else expect(p.metrics.operatingExpenses).toBeUndefined();
      expect(result.periods.map((p) => p.id)).toEqual(["FY2016"]);
      validateV2(companyFromFilingPeriods(s.identity, result.periods));
      const altered = structuredClone(p);
      altered.metrics.netIncome! += 1000;
      expect(businessPeriod(altered)).toBeUndefined();
    }
  );

  it("rejects a pending state for a different accession or extra raw source", async () => {
    const s = await sourceOnlyFixture("AME");
    const state = (await prepareOriginalStandaloneBusinessFiling(
      s.html,
      s.identity,
      s.filing,
      undefined
    ))!;
    expect(() =>
      assertOriginalStandaloneBusinessState(
        { ...state, accession: "0001193125-19-046948" },
        s.identity,
        s.filing
      )
    ).toThrow();
    expect(() =>
      assertOriginalStandaloneBusinessState(
        { ...state, html: s.html } as typeof state,
        s.identity,
        s.filing
      )
    ).toThrow();
    await expect(
      finishOriginalStandaloneBusinessFiling(
        state,
        s.xml.replace("<dei:DocumentFiscalYearFocus", "<dei:WrongFiscalYearFocus"),
        s.instanceUrl,
        s.identity,
        s.filing,
        undefined
      )
    ).rejects.toThrow();
  });
});
