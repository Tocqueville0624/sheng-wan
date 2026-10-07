import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sourceOnlyFixture } from "./fixtures/finance/standalone-business-fixtures";
import {
  prepareOriginalStandaloneBusinessFiling,
  finishOriginalStandaloneBusinessFiling
} from "../scripts/finance/standalone-business-state";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { companyFromFilingPeriods } from "../scripts/finance/current-filing";

describe("UnitedHealth original separate primary HTML and XML", () => {
  it("pins unchanged raw physical table and original XML resource/declaration excerpts", async () => {
    const s = await sourceOnlyFixture("UNH");
    const manifest = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/finance/unitedhealth-fy2016-original-separate-source.json",
          import.meta.url
        ),
        "utf8"
      )
    );
    expect(createHash("sha256").update(s.html).digest("hex")).toBe(manifest.excerptSha256);
    expect(createHash("sha256").update(s.xml).digest("hex")).toBe(manifest.instanceExcerptSha256);
    expect(s.html).not.toMatch(/<ix:nonFraction/i);
  });
  it("recovers all three primary years with no saved company or standard Company Facts", async () => {
    const s = await sourceOnlyFixture("UNH");
    const state = await prepareOriginalStandaloneBusinessFiling(
      s.html,
      s.identity,
      s.filing,
      undefined
    );
    expect(state).toBeDefined();
    expect(JSON.stringify(state)).not.toContain("<table");
    const result = await finishOriginalStandaloneBusinessFiling(
      JSON.parse(JSON.stringify(state!)),
      s.xml,
      s.instanceUrl,
      s.identity,
      s.filing,
      undefined
    );
    expect(result.warnings).toEqual([]);
    expect(result.periods.map((p) => p.id)).toEqual(["FY2016", "FY2017", "FY2018"]);
    validateV2(companyFromFilingPeriods(s.identity, result.periods));
    const p = result.periods[0];
    expect(p.segments!.map((s) => s.revenue)).toEqual([
      144118000000, 26658000000, 13236000000, 828000000
    ]);
    expect(p.metrics).toMatchObject({
      revenue: 184840000000,
      totalOperatingCosts: 171910000000,
      operatingIncome: 12930000000,
      pretaxIncome: 11863000000,
      incomeTax: 4790000000,
      noncontrollingInterestIncome: 56000000,
      netIncome: 7017000000
    });
    expect(p.metrics.grossProfit).toBeUndefined();
    expect(p.operatingCostDetails!.map((c) => c.amount)).toEqual([
      117038000000, 28401000000, 24416000000, 2055000000
    ]);
    expect(flowPeriod(p)).toBeDefined();
    expect(businessPeriod(p)).toBeDefined();
    for (const mutation of [
      "comparative amount",
      "comparative precision",
      "taxonomy",
      "unknown row",
      "tax scope",
      "source identity",
      "source-only attribution",
      "cost allocation"
    ]) {
      const changed = structuredClone(p),
        proof = changed.businessBreakdownSource!.standaloneRevenue!,
        source = proof.source,
        rows = source.tables[0].rows;
      if (mutation === "comparative amount")
        rows[5].cells.find((c) => c.label === "158,453")!.label = "158,454";
      if (mutation === "comparative precision")
        source.originalXml.declarations = source.originalXml.declarations.map((x) =>
          x.includes('contextRef="FD2017Q4YTD"') ? x.replace('decimals="-6"', 'decimals="-3"') : x
        );
      if (mutation === "taxonomy")
        source.originalXml.root = source.originalXml.root.replace(
          "http://www.uhc.com/20181231",
          "http://example.com/20181231"
        );
      if (mutation === "unknown row") rows[7].cells[0].label = "Affiliated segment revenue";
      if (mutation === "tax scope")
        source.tables[0].selection.rows.find((r) => r.rowIndex === 19)!.displayPolarity = "same";
      if (mutation === "source identity")
        source.instanceSource.url = source.instanceSource.url.replace(
          "000073176619000005",
          "000073176619000006"
        );
      if (mutation === "source-only attribution")
        changed.metricSources.netIncome!.tag = "us-gaap:ProfitLoss";
      if (mutation === "cost allocation") changed.operatingCostDetails![0].amount += 1000000;
      expect(businessPeriod(changed), mutation).toBeUndefined();
    }
  });
});
