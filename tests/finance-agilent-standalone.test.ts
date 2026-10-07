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

describe("Agilent original separate fiscal primary and segment tables", () => {
  it("pins unchanged actual HTML and XML excerpts with original fiscal dates and all financial declarations", async () => {
    const s = await sourceOnlyFixture("A");
    const manifest = JSON.parse(
      readFileSync(
        new URL("./fixtures/finance/agilent-fy2016-original-separate-source.json", import.meta.url),
        "utf8"
      )
    );
    expect(createHash("sha256").update(s.html).digest("hex")).toBe(manifest.excerptSha256);
    expect(createHash("sha256").update(s.xml).digest("hex")).toBe(manifest.instanceExcerptSha256);
    expect(s.html).not.toMatch(/<ix:nonFraction/i);
  });
  it("recovers all three fiscal years from original sources without saved data or Company Facts", async () => {
    const s = await sourceOnlyFixture("A"),
      state = await prepareOriginalStandaloneBusinessFiling(
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
    expect(p.startDate).toBe("2015-11-01");
    expect(p.endDate).toBe("2016-10-31");
    expect(p.segments!.map((s) => s.revenue)).toEqual([1992000000, 790000000, 1420000000]);
    expect(p.metrics).toMatchObject({
      revenue: 4202000000,
      costOfRevenue: 2005000000,
      totalOperatingCosts: 3587000000,
      operatingIncome: 615000000,
      pretaxIncome: 544000000,
      incomeTax: 82000000,
      netIncome: 462000000
    });
    expect(result.periods[2].metrics.operatingIncome).toBe(928000000);
    expect(
      result.periods[2].businessBreakdownSource!.standaloneRevenue!.source.originalXml.declarations.some(
        (d) => d.includes(">1122000000</us-gaap:OperatingIncomeLoss>")
      )
    ).toBe(true);
    expect(p.metrics.grossProfit).toBeUndefined();
    expect(p.segments!.every((s) => s.grossProfit === undefined)).toBe(true);
    expect(p.operatingCostDetails!.map((c) => c.amount)).toEqual([
      1457000000, 548000000, 329000000, 1253000000
    ]);
    expect(
      p.businessBreakdownSource!.standaloneRevenue!.source.originalXml.declarations
    ).toHaveLength(96);
    for (const annual of result.periods) {
      expect(flowPeriod(annual)).toBeDefined();
      expect(businessPeriod(annual)).toBeDefined();
    }
    for (const mutation of [
      "comparative amount",
      "comparative precision",
      "taxonomy",
      "unknown revenue row",
      "fiscal date",
      "fiscal profile",
      "display scale",
      "column geometry",
      "segment scope",
      "segment year header",
      "segment operating profit",
      "source identity",
      "source-only attribution",
      "cost allocation"
    ]) {
      const changed = structuredClone(p),
        source = changed.businessBreakdownSource!.standaloneRevenue!.source,
        [primary, segments] = source.tables;
      if (mutation === "comparative amount")
        primary.rows[6].cells.find((c) => c.label === "3,397")!.label = "3,398";
      if (mutation === "comparative precision")
        source.originalXml.declarations = source.originalXml.declarations.map((x) =>
          x.includes('contextRef="FD2017Q4YTD"') ? x.replace('decimals="-6"', 'decimals="-3"') : x
        );
      if (mutation === "taxonomy")
        source.originalXml.root = source.originalXml.root.replace(
          "http://www.agilent.com/20181031",
          "http://example.com/20181031"
        );
      if (mutation === "unknown revenue row")
        segments.rows[15].cells[0].label = "Affiliated segment sales";
      if (mutation === "fiscal date") changed.startDate = "2016-01-01";
      if (mutation === "fiscal profile") delete primary.selection.fiscalProfile;
      if (mutation === "display scale") delete segments.selection.scale;
      if (mutation === "column geometry") primary.selection.rows[0].columns[2].span = 4;
      if (mutation === "segment scope")
        segments.selection.rows[0].dimensions["srt:ConsolidationItemsAxis"] =
          "us-gaap:OperatingSegmentsMember";
      if (mutation === "segment year header")
        segments.rows[9].cells[0].label = "Year ended December 31, 2017:";
      if (mutation === "segment operating profit")
        segments.rows[6].cells.find((c) => c.label === "547")!.label = "548";
      if (mutation === "source identity")
        source.instanceSource.url = source.instanceSource.url.replace(
          "000109087218000019",
          "000109087218000020"
        );
      if (mutation === "source-only attribution")
        changed.metricSources.revenue!.tag = "us-gaap:Revenues";
      if (mutation === "cost allocation") changed.operatingCostDetails![0].amount += 1000000;
      expect(businessPeriod(changed), mutation).toBeUndefined();
    }
  });
  it("preserves the previously reported fiscal amounts and source attribution while adding the absent business partition", async () => {
    const s = await sourceOnlyFixture("A"),
      old = JSON.parse(
        readFileSync(
          new URL(
            "./fixtures/finance/agilent-fy2016-original-separate-source.json",
            import.meta.url
          ),
          "utf8"
        )
      ).preservedPeriod;
    expect(s.preserved.period.metrics).toEqual(old.metrics);
    expect(s.preserved.period.metricSources).toEqual(old.metricSources);
    expect(s.preserved.period.startDate).toBe(old.startDate);
    expect(s.preserved.period.endDate).toBe(old.endDate);
    expect(s.preserved.period.segments!.map((s) => s.revenue)).toEqual([
      1992000000, 790000000, 1420000000
    ]);
    expect(flowPeriod(s.preserved.period)).toBeDefined();
  });
});
