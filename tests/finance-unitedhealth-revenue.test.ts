import { describe, expect, it } from "vitest";
import { originalBusinessFixture } from "./fixtures/finance/original-business-fixtures";
import { businessPeriod } from "../scripts/finance/v2-model";

describe("UnitedHealth original consolidated revenue sources", () => {
  it("preserves premiums, product/service and investment scopes rather than affiliated division sales", () => {
    const { period } = originalBusinessFixture("UNHAnnual", "source-only");
    expect(period.segments!.map((s) => s.label)).toEqual([
      "Premiums",
      "Products",
      "Services",
      "Investment and other income"
    ]);
    expect(period.segments!.map((s) => s.revenue)).toEqual([
      352229000000, 53380000000, 38038000000, 3920000000
    ]);
    expect(period.metrics.revenue).toBe(447567000000);
    const original = period.businessBreakdownSource!.originalRevenueRows!;
    expect(original.rows.filter((r) => r.cells.some((c) => c.fact))).toHaveLength(5);
    expect(original.rows.at(-1)!.cells.filter((c) => c.fact)).toHaveLength(3);
  });
  it("retains all actual quarter and year-to-date columns without mixing their scopes", () => {
    const { period } = originalBusinessFixture("UNHQuarter", "source-only");
    const rows = period.businessBreakdownSource!.originalRevenueRows!.rows;
    expect(rows.at(-1)!.cells.filter((c) => c.fact)).toHaveLength(4);
    expect(
      rows
        .at(-1)!
        .cells.filter((c) => c.fact)
        .map((c) => [c.fact!.startDate, c.fact!.endDate, c.fact!.value])
    ).toEqual([
      ["2026-04-01", "2026-06-30", 112032000000],
      ["2025-04-01", "2025-06-30", 111616000000],
      ["2026-01-01", "2026-06-30", 223753000000],
      ["2025-01-01", "2025-06-30", 221191000000]
    ]);
    expect(period.segments!.map((s) => s.revenue)).toEqual([
      86956000000, 13835000000, 10018000000, 1223000000
    ]);
  });
  it.each([
    "unknown row",
    "unreported residual",
    "affiliated member",
    "wrong date",
    "changed comparison",
    "changed original declaration"
  ])("withholds %s even when the selected total still balances", (mutation) => {
    const { period } = originalBusinessFixture(
      mutation === "changed original declaration" ? "UNHAnnual" : "UNHQuarter",
      "source-only"
    );
    const p = structuredClone(period),
      rows = p.businessBreakdownSource!.originalRevenueRows!.rows;
    const monetary = rows.filter((r) => r.cells.some((c) => c.fact));
    if (mutation === "unknown row") monetary[1].cells[0].label = "Affiliated division sales";
    if (mutation === "unreported residual")
      p.revenueAdjustments = [{ id: "other", label: "Other", revenue: 1 }];
    if (mutation === "affiliated member")
      monetary[1].cells.find((c) => c.fact)!.fact!.dimensions = {
        "srt:StatementBusinessSegmentsAxis": "unh:OptumMember"
      };
    if (mutation === "wrong date")
      rows[1].cells.find((c) => c.label.includes("June"))!.label =
        "Three Months Ended September 30,";
    if (mutation === "changed comparison") monetary[0].cells.filter((c) => c.fact)[1].label = "1";
    if (mutation === "changed original declaration") {
      const f = monetary[0].cells.find((c) => c.fact)!.fact!;
      f.declarations![0].contextId = "foreign-context";
    }
    expect(businessPeriod(p)).toBeUndefined();
  });
});
