import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sourceOnlyFixture } from "./fixtures/finance/standalone-business-fixtures";
import { originalBusinessFixture } from "./fixtures/finance/original-business-fixtures";
import {
  prepareOriginalStandaloneBusinessFiling,
  finishOriginalStandaloneBusinessFiling
} from "../scripts/finance/standalone-business-state";
import { companyFromFilingPeriods } from "../scripts/finance/current-filing";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { buildStatementFlow } from "../src/features/finance/chart-model";
import { alignOriginalIncomeFixture } from "./fixtures/finance/align-original-income-fixture";
import type { PeriodV2 } from "../src/features/finance/v2-types";

describe("Align original business classifications and signed primary income", () => {
  it("pins unchanged original separate HTML/XML and preserves reported historical business names", async () => {
    const s = await sourceOnlyFixture("ALGN");
    const manifest = JSON.parse(
      readFileSync(
        new URL("./fixtures/finance/align-fy2016-original-separate-source.json", import.meta.url),
        "utf8"
      )
    );
    expect(createHash("sha256").update(s.html).digest("hex")).toBe(manifest.excerptSha256);
    expect(createHash("sha256").update(s.xml).digest("hex")).toBe(manifest.instanceExcerptSha256);
    expect(s.html).not.toMatch(/<ix:nonFraction/i);
    const p = s.preserved.period;
    expect(p.segments!.map((s) => [s.label, s.revenue])).toEqual([
      ["Clear Aligner", 958327000],
      ["Scanner", 121547000]
    ]);
    expect(p.segments![1].revenueSource!.dimensions).toEqual({
      "us-gaap:StatementBusinessSegmentsAxis": "algn:InvisalignExpressliteMember"
    });
    for (const [key, value] of Object.entries(manifest.preservedPeriod.metrics))
      expect(p.metrics[key as keyof PeriodV2["metrics"]]).toBe(value);
    for (const [key, value] of Object.entries(manifest.preservedPeriod.metricSources))
      expect(p.metricSources[key as keyof PeriodV2["metrics"]]).toEqual(value);
    expect(p.metrics.equityMethodIncome).toBe(-1684000);
    expect(
      p.businessBreakdownSource!.standaloneRevenue!.source.originalXml.declarations
    ).toHaveLength(45);
    expect(flowPeriod(p)).toBeDefined();
  });
  it("recovers all three original comparative years without Company Facts or saved data", async () => {
    const s = await sourceOnlyFixture("ALGN"),
      state = await prepareOriginalStandaloneBusinessFiling(
        s.html,
        s.identity,
        s.filing,
        undefined
      );
    expect(state).toBeDefined();
    expect(JSON.stringify(state)).not.toContain("<table");
    const result = await finishOriginalStandaloneBusinessFiling(
      JSON.parse(JSON.stringify(state)),
      s.xml,
      s.instanceUrl,
      s.identity,
      s.filing,
      undefined
    );
    expect(result.warnings).toEqual([]);
    expect(result.periods.map((p) => p.id)).toEqual(["FY2016", "FY2017", "FY2018"]);
    validateV2(companyFromFilingPeriods(s.identity, result.periods));
    for (const p of result.periods) {
      expect(p.segments!.reduce((n, s) => n + s.revenue, 0)).toBe(p.metrics.revenue);
      expect(p.metrics.pretaxIncome! - p.metrics.incomeTax! + p.metrics.equityMethodIncome!).toBe(
        p.metrics.netIncome
      );
      expect(p.segments!.every((s) => s.grossProfit === undefined)).toBe(true);
      expect(flowPeriod(p)).toBeDefined();
      expect(businessPeriod(p)).toBeDefined();
    }
    for (const mutation of [
      "comparative amount",
      "XML precision",
      "visible business label",
      "business scope",
      "primary units",
      "segment units",
      "period",
      "accession",
      "taxonomy",
      "equity sign",
      "extra primary row",
      "source-only provenance",
      "invented business gross profit"
    ]) {
      const p = structuredClone(result.periods[0]),
        proof = p.businessBreakdownSource!.standaloneRevenue!,
        s = proof.source,
        [primary, business] = s.tables;
      if (mutation === "comparative amount")
        primary.rows[4].cells.find((c) => c.label === "1,966,492")!.label = "1,966,493";
      if (mutation === "XML precision")
        s.originalXml.declarations[0] = s.originalXml.declarations[0].replace(
          'decimals="-3"',
          'decimals="-6"'
        );
      if (mutation === "visible business label")
        business.rows[6].cells[0].label = "Systems and Services";
      if (mutation === "business scope")
        business.selection.rows[0].dimensions = {
          "us-gaap:StatementBusinessSegmentsAxis": "algn:ClearAlignerMember"
        };
      if (mutation === "primary units")
        primary.precedingText = primary.precedingText.replace(
          "(in thousands, except per share data)",
          "(in millions, except per share data)"
        );
      if (mutation === "segment units")
        business.precedingText = business.precedingText.replace(
          "(in thousands):",
          "(in millions):"
        );
      if (mutation === "period") p.startDate = "2015-11-01";
      if (mutation === "accession") s.accession = "0001097149-19-000010";
      if (mutation === "taxonomy")
        s.originalXml.root = s.originalXml.root.replace(
          "http://www.aligntech.com/20181231",
          "http://example.com/20181231"
        );
      if (mutation === "equity sign") p.metrics.equityMethodIncome = 1684000;
      if (mutation === "extra primary row")
        primary.rows.splice(7, 0, structuredClone(primary.rows[7]));
      if (mutation === "source-only provenance")
        p.metricSources.costOfRevenue!.label = "Cost estimate";
      if (mutation === "invented business gross profit") p.segments![0].grossProfit = 0;
      expect(businessPeriod(p), mutation).toBeUndefined();
      expect(flowPeriod(p), mutation).toBeUndefined();
    }
  });
  it.each(["ALGNAnnual", "ALGNQuarter", "ALGNLegacyAnnual"] as const)(
    "%s rejects mixed-axis scope, incomplete comparatives and changed external units",
    (name) => {
      const original = originalBusinessFixture(name).period;
      for (const mutation of [
        "primary units",
        "segment units",
        "extra axis",
        "member identity",
        "comparative amount",
        "missing branch"
      ]) {
        const p = structuredClone(original),
          proof = p.businessBreakdownSource!.originalRevenueRows!;
        const row = proof.rows.find((r) => r.cells.some((c) => c.fact))!,
          cell = row.cells.find((c) => c.fact)!;
        if (mutation === "primary units")
          proof.primaryPrecedingText = proof.primaryPrecedingText!.replace(
            "in thousands",
            "in millions"
          );
        if (mutation === "segment units")
          proof.precedingText = proof.precedingText!.replace("in thousands", "in millions");
        if (mutation === "extra axis")
          cell.fact!.dimensions["srt:ProductOrServiceAxis"] = "us-gaap:ProductMember";
        if (mutation === "member identity")
          cell.fact!.dimensions["us-gaap:StatementBusinessSegmentsAxis"] = "algn:UnknownMember";
        if (mutation === "comparative amount")
          row.cells.filter((c) => c.fact).at(-1)!.fact!.value += 1000;
        if (mutation === "missing branch") proof.rows.splice(row.rowIndex, 1);
        expect(businessPeriod(p), mutation).toBeUndefined();
      }
    }
  );
  it("preserves original impairments, litigation gain and signed after-tax equity loss in the 2019 ledger", () => {
    const s = alignOriginalIncomeFixture(),
      p = s.period;
    expect(createHash("sha256").update(s.html).digest("hex")).toBe(s.source.excerptSha256);
    expect(p.alignInlineIncome).toBeDefined();
    expect(p.metrics.equityMethodIncome).toBe(-7528000);
    expect(p.grossOperatingItems!.operatingCosts.map((c) => c.amount)).toEqual([
      1072053000, 157361000, 22990000, -51000000
    ]);
    for (const [key, value] of Object.entries(s.source.preservedPeriod.metrics))
      expect(p.metrics[key as keyof PeriodV2["metrics"]]).toBe(value);
    expect(p.metrics.pretaxIncome! - p.metrics.incomeTax! + p.metrics.equityMethodIncome!).toBe(
      p.metrics.netIncome
    );
    expect(flowPeriod(p)).toBeDefined();
    validateV2(s.company);
    const graph = buildStatementFlow(flowPeriod(p)!);
    expect(graph.ok).toBe(true);
    if (!graph.ok) throw Error(graph.reason);
    for (const node of graph.graph.nodes) {
      const inputs = graph.graph.links
          .filter((l) => l.target === node.id)
          .reduce((n, l) => n + l.value, 0),
        outputs = graph.graph.links
          .filter((l) => l.source === node.id)
          .reduce((n, l) => n + l.value, 0);
      if (inputs && outputs) expect(inputs).toBe(outputs);
    }
    for (const mutation of [
      "comparative amount",
      "displayed gain sign",
      "income date",
      "equity sign",
      "missing row",
      "changed unit",
      "changed operating gain",
      "missing proof"
    ]) {
      const changed = structuredClone(p),
        proof = changed.alignInlineIncome!;
      if (mutation === "comparative amount")
        proof.rows[3].cells.find((c) => c.fact)!.fact!.value += 1000;
      if (mutation === "displayed gain sign")
        proof.rows[12].cells.filter((c) => c.fact).at(-1)!.label = "51,000";
      if (mutation === "income date")
        proof.rows[21].cells.filter((c) => c.fact).at(-1)!.fact!.startDate = "2019-04-01";
      if (mutation === "equity sign") changed.metrics.equityMethodIncome = 7528000;
      if (mutation === "missing row") proof.rows.splice(11, 1);
      if (mutation === "changed unit")
        proof.precedingText = proof.precedingText.replace("in thousands", "in millions");
      if (mutation === "changed operating gain")
        changed.grossOperatingItems!.operatingCosts[3].amount = 51000000;
      if (mutation === "missing proof") delete changed.alignInlineIncome;
      expect(flowPeriod(changed), mutation).toBeUndefined();
      expect(buildStatementFlow(changed as never).ok, mutation).toBe(false);
    }
  });
});
