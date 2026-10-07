import type { JpmRevenueProof } from "./jpm-types";
import type { PeriodV2 } from "./v2-types";
import type { RevenueSegment } from "./types";
import { decodeJpmRows, packJpmOriginalRows } from "./jpm-original-rows";
import { validateJpmOriginalSemantics } from "./jpm-source-semantics";

function demand(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x
  );
export const jpmRevenueBasis =
  "Reported JPMorgan Chase business net revenues retain their original noninterest and net-interest components. Corporate and reconciling items keep their reported signs; negative contributions are separate deductions, never allocated to businesses. All original current, comparative and cumulative columns reconcile to the independent primary net-revenue statement. The 2024 business merger is bound to its original explanation; legacy source member names remain unchanged. Business gross profit and missing business splits are not estimated.";

/** Replay every original source column before projecting one selected period. */
export function originalJpmRevenuePartition(period: PeriodV2, proof: JpmRevenueProof) {
  demand(
    proof &&
      Object.keys(proof).every((k) =>
        [
          "ruleId",
          "encoding",
          "resources",
          "reportDate",
          "form",
          "originalFiscalYear",
          "originalFiscalPeriod",
          "units",
          "primary",
          "business",
          "originalNotes"
        ].includes(k)
      ) &&
      proof.ruleId === "jpm-original-complete-net-revenue-v1" &&
      proof.encoding === "jpm-original-resource-tuples-v1",
    "Unknown original JPM proof profile"
  );
  const url = new URL(period.sourceUrl),
    directory = `/Archives/edgar/data/19617/${period.accession?.replaceAll("-", "")}/`;
  demand(
    url.origin === "https://www.sec.gov" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.startsWith(directory) &&
      /^[\w.-]+$/.test(url.pathname.slice(directory.length)) &&
      /^\d{10}-\d{2}-\d{6}$/.test(period.accession ?? "") &&
      period.reportingCurrency === "USD" &&
      period.displayCurrency === "USD" &&
      !period.fx,
    "Original JPM source identity or currency changed"
  );
  demand(
    Array.isArray(proof.business) && [2, 4].includes(proof.business.length),
    "Incomplete original JPM source regions"
  );
  const regions = [proof.primary, ...proof.business];
  demand(
    regions.every(
      (r) =>
        r &&
        Object.keys(r).every((k) => ["tableIndex", "rows"].includes(k)) &&
        Number.isInteger(r.tableIndex) &&
        r.tableIndex >= 0 &&
        r.tableIndex < 5000
    ) && new Set(regions.map((r) => r.tableIndex)).size === regions.length,
    "Ambiguous original JPM region identity"
  );
  demand(
    !proof.originalNotes ||
      proof.originalNotes.every((n) =>
        Object.keys(n).every((k) =>
          ["offset", "endOffset", "originalHtml", "originalText"].includes(k)
        )
      ),
    "Unknown original JPM note property"
  );
  const decoded = regions.map((r) => decodeJpmRows(r.rows, proof.resources)),
    packed = packJpmOriginalRows(decoded);
  demand(
    canonical(packed.resources) === canonical(proof.resources) &&
      canonical(packed.rows) === canonical(regions.map((r) => r.rows)),
    "Unused or altered JPM source dictionary resources"
  );
  const source = {
    filing: {
      sourceUrl: period.sourceUrl,
      accession: period.accession!,
      filedAt: period.filedAt,
      reportDate: proof.reportDate,
      form: proof.form,
      primaryDocument: url.pathname.slice(directory.length),
      directoryUrl: url.origin + directory
    },
    originalFocus: {
      year: proof.originalFiscalYear,
      period: proof.originalFiscalPeriod,
      end: proof.reportDate
    },
    regions: proof.business.map((r, i) => ({
      tableIndex: r.tableIndex,
      originalRows: decoded[i + 1],
      units: proof.units
    })),
    originalNotes: proof.originalNotes
  };
  const replay = validateJpmOriginalSemantics(source, {
      tableIndex: proof.primary.tableIndex,
      originalRows: decoded[0]
    }),
    scope = replay.scopes.find((s) => s.dates === period.startDate + "|" + period.endDate),
    revenue = period.metricSources.revenue;
  demand(
    scope &&
      period.metrics.revenue === scope.consolidated.values[2] &&
      revenue &&
      revenue.method === "reported" &&
      revenue.tag === "us-gaap:RevenuesNetOfInterestExpense" &&
      revenue.sourceUrl === period.sourceUrl &&
      revenue.accession === period.accession &&
      revenue.filedAt === period.filedAt,
    "Selected JPM revenue differs from its unchanged primary source"
  );
  demand(
    period.kind === "annual"
      ? period.startDate === `${period.fiscalYear}-01-01` &&
          period.endDate === `${period.fiscalYear}-12-31`
      : period.fiscalQuarter &&
          period.fiscalQuarter >= 1 &&
          period.fiscalQuarter <= 3 &&
          period.startDate ===
            `${period.fiscalYear}-${["01-01", "04-01", "07-01"][period.fiscalQuarter - 1]}` &&
          period.endDate ===
            `${period.fiscalYear}-${["03-31", "06-30", "09-30"][period.fiscalQuarter - 1]}`,
    "Selected JPM fiscal scope changed"
  );
  const segments: RevenueSegment[] = [],
    adjustments: RevenueSegment[] = [];
  const groups = [...scope.business, scope.corporate!, scope.reconciliation!];
  for (const group of groups) {
    const cell = group.revenueCell,
      fact = cell.fact!;
    if (!fact.value) continue;
    const item: RevenueSegment = {
      id:
        "jpm-" +
        group.caption
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/-$/, ""),
      label: group.caption,
      revenue: fact.value,
      revenueSource: {
        sourceUrl: period.sourceUrl,
        accession: period.accession!,
        filedAt: period.filedAt,
        startDate: period.startDate,
        endDate: period.endDate,
        currency: "USD",
        tag: fact.tag,
        dimensions: fact.dimensions,
        value: fact.value,
        decimals: fact.decimals,
        tableLabel: group.caption,
        rowLabel: "Total net revenue",
        rowIndex: group.revenueRow,
        columnIndex: cell.columnIndex
      }
    };
    (fact.value > 0 ? segments : adjustments).push(item);
  }
  demand(
    new Set([...segments, ...adjustments].map((s) => s.id)).size ===
      groups.filter((g) => g.values[2] !== 0).length,
    "Duplicate JPM branch identity"
  );
  return { segments, adjustments, tableIndex: scope.business[0].table };
}

export function jpmRevenueProblem(period: PeriodV2): string | undefined {
  try {
    const source = period.businessBreakdownSource,
      proof = source?.jpmRevenue;
    demand(
      source?.method === "reviewed-jpm-revenue" &&
        proof &&
        source.ruleId === proof.ruleId &&
        source.totalTableIndex === proof.primary.tableIndex &&
        source.sourceUrl === period.sourceUrl &&
        source.accession === period.accession &&
        source.revenue === period.metrics.revenue &&
        source.revenueTag === period.metricSources.revenue?.tag &&
        source.revenueDecimals === -6 &&
        source.totalLabel === "Total net revenue" &&
        period.segmentSourceUrl === period.sourceUrl &&
        period.segmentBasis === jpmRevenueBasis &&
        Object.keys(source).every((k) =>
          [
            "method",
            "ruleId",
            "jpmRevenue",
            "tableIndex",
            "totalTableIndex",
            "sourceUrl",
            "accession",
            "revenueTag",
            "revenue",
            "revenueDecimals",
            "totalLabel",
            "omittedSubtotals",
            "omittedZeroColumns"
          ].includes(k)
        ) &&
        canonical(source.omittedSubtotals) === "[]" &&
        canonical(source.omittedZeroColumns) === "[]",
      "Changed original JPM proof envelope"
    );
    const replay = originalJpmRevenuePartition(period, proof);
    demand(
      source.tableIndex === replay.tableIndex &&
        canonical(period.segments) === canonical(replay.segments) &&
        canonical(period.revenueAdjustments) === canonical(replay.adjustments),
      "JPM business or adjustment branches differ from original source"
    );
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid original JPM revenue proof";
  }
}
