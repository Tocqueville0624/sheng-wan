import type { CatalogCompany, CompanyV2, PeriodV2 } from "../../src/features/finance/v2-types";
import {
  originalStandaloneBusinessSelections,
  originalStandaloneBusinessSegments,
  originalStandaloneBusinessBasis,
  originalStandaloneReportedMetrics,
  type OriginalStandaloneBusinessProof
} from "../../src/features/finance/standalone-business";
import {
  readOriginalStandalonePreparedRevenueRows,
  OriginalStandaloneRevenueJoinError,
  type OriginalStandalonePhysicalTable
} from "./standalone-revenue-reader";
import { parseOriginalStandaloneXbrl } from "./standalone-xbrl";
import { originalRevenueGrid } from "./original-revenue-grid";
import { originalStandaloneIndexUrl } from "./standalone-source-index";
import { visibleText } from "./business-v2";
import { businessPeriod, flowPeriod } from "./v2-model";
import type { SecFiling } from "./sec-shared";
import { enrichOriginalAlbemarleIncome } from "../../src/features/finance/standalone-income";

const hash = async (s: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))),
    (b) => b.toString(16).padStart(2, "0")
  ).join("");
type Binding = {
  id: string;
  fiscalYear: number;
  primaryIndex: number;
  businessIndex: number;
  primaryProfile?: "income-statement";
};
export type PreparedOriginalStandaloneBusiness = {
  format: "original-standalone-business-pending-v1";
  cik: string;
  accession: string;
  primaryUrl: string;
  primarySha256: string;
  bindings: Binding[];
  tables: OriginalStandalonePhysicalTable[];
};
const candidates = (base: CompanyV2 | undefined, fresh: PeriodV2[]) => {
  const result = new Map((base?.annual ?? []).map((p) => [p.id, p]));
  for (const p of fresh) {
    const prior = result.get(p.id);
    if (p.kind === "annual" && (!prior || p.filedAt > prior.filedAt)) result.set(p.id, p);
  }
  return [...result.values()];
};
const eligible = (p: PeriodV2, filing: SecFiling) =>
  p.kind === "annual" &&
  p.sourceUrl === filing.sourceUrl &&
  p.accession === filing.accession &&
  p.filedAt === filing.filedAt &&
  p.fiscalYear >= 2016 &&
  p.fiscalYear <= 2018;
const needsOriginalCapability = (p: PeriodV2, cik: string) =>
  !p.coverage.segments || (cik === "0000915913" && p.fiscalYear === 2016 && !p.coverage.sankey);
export function originalStandaloneBusinessRequired(
  identity: CatalogCompany,
  filing: SecFiling,
  base: CompanyV2 | undefined,
  fresh: PeriodV2[] = []
): boolean {
  if (
    !["0000915913", "0001037868"].includes(identity.cik) ||
    !/^10-K(?:\/A)?$/.test(filing.form) ||
    filing.reportDate !== "2018-12-31"
  )
    return false;
  originalStandaloneIndexUrl(identity.cik, filing);
  const all = candidates(base, fresh);
  return [2016, 2017, 2018].some((year) => {
    const prior = all.filter((p) => p.fiscalYear === year);
    return (
      !prior.length ||
      prior.some((p) => eligible(p, filing) && needsOriginalCapability(p, identity.cik))
    );
  });
}

/** Acquisition step one: preserve actual physical cells and the whole HTML hash.
 * No XML name is guessed, no amount is inferred, and full HTML never enters the
 * persistent queue state. Exact XML scopes are checked only after acquisition. */
export async function prepareOriginalStandaloneBusinessFiling(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  base: CompanyV2 | undefined,
  fresh: PeriodV2[] = []
): Promise<PreparedOriginalStandaloneBusiness | undefined> {
  if (!originalStandaloneBusinessRequired(identity, filing, base, fresh)) return;
  if (
    new TextEncoder().encode(html).length > 24 * 1024 ** 2 ||
    /<(?:[\w.-]+:)?nonFraction\b/i.test(html)
  )
    throw Error("Original standalone primary is oversized or contains inline declarations.");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  if (tables.length > 5000) throw Error("Too many original standalone tables.");
  const { grid } = originalRevenueGrid(
    html,
    { facts: [], fiscalYear: 0, fiscalPeriod: "", periodEnd: "" },
    identity.cik
  );
  const layouts = tables.flatMap((t, tableIndex): OriginalStandalonePhysicalTable[] => {
    if (t[0].length > 512000 || /<table\b/i.test(t[0].slice(t[0].indexOf(">") + 1))) return [];
    const text = visibleText(t[0]);
    if (
      !text.includes("Net sales") &&
      !text.includes("Consolidated net sales") &&
      !text.includes("Total net sales")
    )
      return [];
    const n = [...t[0].matchAll(/<tr\b/gi)].length;
    if (n > 200) return [];
    return [
      {
        tableIndex,
        rows: grid(t[0], new Set(Array.from({ length: n }, (_, i) => i))),
        precedingText: visibleText(html.slice(Math.max(0, t.index! - 8000), t.index!))
      }
    ];
  });
  const label = (t: OriginalStandalonePhysicalTable, i: number) => t.rows[i]?.cells[0]?.label;
  const primary = layouts.filter((t) =>
    identity.cik === "0000915913"
      ? label(t, 4) === "Net sales" &&
        label(t, 15) === "Income tax expense" &&
        /Albemarle Corporation and Subsidiaries CONSOLIDATED STATEMENTS OF INCOME$/.test(
          t.precedingText
        )
      : label(t, 3) === "Net sales" &&
        label(t, 16) === "Provision for income taxes" &&
        t.precedingText.endsWith(
          "Consolidated Statement of Income (In thousands, except per share amounts)"
        )
  );
  if (primary.length !== 1) return;
  const all = candidates(base, fresh),
    bindings: Binding[] = [];
  const selected = new Map<number, OriginalStandalonePhysicalTable>();
  for (const year of [2016, 2017, 2018]) {
    const matching = all.filter((p) => p.fiscalYear === year);
    const prior = matching.find((p) => eligible(p, filing));
    // A different source/date interpretation for this fiscal year is preserved;
    // absence is the only condition that permits a new source-only candidate.
    if ((prior && !needsOriginalCapability(prior, identity.cik)) || (matching.length && !prior))
      continue;
    const business = layouts.filter((t) =>
      identity.cik === "0000915913"
        ? label(t, 5) === "Net sales:" &&
          label(t, 6) === "Lithium" &&
          label(t, 11) === "Total net sales" &&
          t.rows[3]?.cells
            .filter((c) => c.label)
            .map((c) => c.label)
            .join("|") === "2018|2017|2016" &&
          t.rows[4]?.cells
            .filter((c) => c.label)
            .map((c) => c.label)
            .join("") === "(In thousands)"
        : label(t, 22) === "Consolidated net sales" &&
          t.rows[1]?.cells
            .filter((c) => c.label)
            .map((c) => c.label)
            .join("") === String(year)
    );
    if (business.length !== 1) continue;
    selected.set(primary[0].tableIndex, primary[0]);
    selected.set(business[0].tableIndex, business[0]);
    bindings.push({
      id: prior?.id ?? `FY${year}`,
      fiscalYear: year,
      primaryIndex: primary[0].tableIndex,
      businessIndex: business[0].tableIndex,
      ...(!prior ? { primaryProfile: "income-statement" as const } : {})
    });
  }
  if (!bindings.length) return;
  const state: PreparedOriginalStandaloneBusiness = {
    format: "original-standalone-business-pending-v1",
    cik: identity.cik,
    accession: filing.accession,
    primaryUrl: filing.sourceUrl,
    primarySha256: await hash(html),
    bindings,
    tables: [...selected.values()]
  };
  assertOriginalStandaloneBusinessState(state, identity, filing);
  return state;
}

export function assertOriginalStandaloneBusinessState(
  state: PreparedOriginalStandaloneBusiness,
  identity: CatalogCompany,
  filing: SecFiling
) {
  originalStandaloneIndexUrl(identity.cik, filing);
  if (
    Object.keys(state).sort().join("|") !==
      "accession|bindings|cik|format|primarySha256|primaryUrl|tables" ||
    state.format !== "original-standalone-business-pending-v1" ||
    state.cik !== identity.cik ||
    state.accession !== filing.accession ||
    state.primaryUrl !== filing.sourceUrl ||
    !/^[a-f0-9]{64}$/.test(state.primarySha256) ||
    !Array.isArray(state.bindings) ||
    !state.bindings.length ||
    state.bindings.length > 3 ||
    !Array.isArray(state.tables) ||
    state.tables.length < 2 ||
    state.tables.length > 4 ||
    new Set(state.tables.map((t) => t.tableIndex)).size !== state.tables.length ||
    new Set(state.bindings.map((b) => b.id)).size !== state.bindings.length ||
    new Set(state.bindings.map((b) => b.fiscalYear)).size !== state.bindings.length ||
    state.bindings.some(
      (b) =>
        !Number.isInteger(b.fiscalYear) ||
        b.fiscalYear < 2016 ||
        b.fiscalYear > 2018 ||
        b.id !== `FY${b.fiscalYear}` ||
        b.primaryIndex === b.businessIndex ||
        !state.tables.some((t) => t.tableIndex === b.primaryIndex) ||
        !state.tables.some((t) => t.tableIndex === b.businessIndex) ||
        (b.primaryProfile !== undefined && b.primaryProfile !== "income-statement")
    ) ||
    new TextEncoder().encode(JSON.stringify(state)).length > 262144
  )
    throw Error("Invalid or oversized original standalone business state.");
}

/** Acquisition step three: actual XML completes the preserved physical proof.
 * This also handles a first import with no Company Facts or saved company. */
export async function finishOriginalStandaloneBusinessFiling(
  state: PreparedOriginalStandaloneBusiness,
  xml: string,
  instanceUrl: string,
  identity: CatalogCompany,
  filing: SecFiling,
  base: CompanyV2 | undefined,
  fresh: PeriodV2[] = []
): Promise<{ periods: PeriodV2[]; warnings: string[] }> {
  assertOriginalStandaloneBusinessState(state, identity, filing);
  const instance = parseOriginalStandaloneXbrl(xml, identity.cik);
  const fiscal = instance.metadata.filter((m) => m.tag === "dei:DocumentFiscalYearFocus"),
    end = instance.metadata.filter((m) => m.tag === "dei:DocumentPeriodEndDate");
  if (
    fiscal.length !== 1 ||
    end.length !== 1 ||
    Number(fiscal[0].lexical) !== 2018 ||
    end[0].lexical !== filing.reportDate
  )
    throw Error("Original standalone XML fiscal metadata does not match the primary filing.");
  const all = candidates(base, fresh),
    periods: PeriodV2[] = [],
    warnings: string[] = [];
  const sourceHashes = { primarySha256: state.primarySha256, instanceSha256: await hash(xml) };
  for (const binding of state.bindings) {
    const matching = all.filter((p) => p.fiscalYear === binding.fiscalYear);
    const prior = matching.find((p) => eligible(p, filing) && p.id === binding.id);
    if ((prior && !needsOriginalCapability(prior, identity.cik)) || (matching.length && !prior))
      continue;
    if (!prior && binding.primaryProfile !== "income-statement")
      throw Error("An original source-only candidate requires its full primary metric profile.");
    if (prior && binding.primaryProfile)
      throw Error("Source-only metric profile may not replace a preserved financial candidate.");
    try {
      const selected = [binding.primaryIndex, binding.businessIndex].map((index) =>
        state.tables.find((t) => t.tableIndex === index)!
      );
      const source = readOriginalStandalonePreparedRevenueRows(
        {
          cik: identity.cik,
          accession: filing.accession,
          primaryUrl: filing.sourceUrl,
          primaryTables: selected,
          instanceUrl,
          instanceXml: xml
        },
        originalStandaloneBusinessSelections(
          identity.cik,
          2018,
          binding.fiscalYear,
          binding.primaryIndex,
          binding.businessIndex,
          binding.primaryProfile
        ),
        sourceHashes
      );
      const shell = {
        id: binding.id,
        label: `FY ${binding.fiscalYear}`,
        kind: "annual" as const,
        fiscalYear: binding.fiscalYear,
        startDate: `${binding.fiscalYear}-01-01`,
        endDate: `${binding.fiscalYear}-12-31`,
        filedAt: filing.filedAt,
        accession: filing.accession,
        sourceUrl: filing.sourceUrl,
        reportingCurrency: "USD",
        displayCurrency: "USD",
        derived: false,
        coverage: { basics: true, segments: false, sankey: false }
      };
      const p: PeriodV2 = prior ?? {
        ...shell,
        ...originalStandaloneReportedMetrics(shell, identity.cik, source.joins[0])
      };
      const proof: OriginalStandaloneBusinessProof = {
        ruleId:
          identity.cik === "0000915913"
            ? "alb-original-separate-revenue-v1"
            : "ame-original-separate-closing-sales-v1",
        reportDate: filing.reportDate,
        form: filing.form,
        source: source.proof,
        ...(binding.primaryProfile ? { primaryProfile: binding.primaryProfile } : {})
      };
      let next: PeriodV2 = {
        ...p,
        segments: originalStandaloneBusinessSegments(p, proof),
        segmentSourceUrl: p.sourceUrl,
        segmentBasis: originalStandaloneBusinessBasis(proof.ruleId),
        businessBreakdownSource: {
          method: "reviewed-original-standalone-revenue",
          standaloneRevenue: proof,
          ruleId: proof.ruleId,
          tableIndex: binding.businessIndex,
          totalTableIndex: binding.primaryIndex,
          sourceUrl: p.sourceUrl,
          accession: p.accession!,
          revenueTag: p.metricSources.revenue!.tag,
          revenue: p.metrics.revenue!,
          revenueDecimals: -3,
          totalLabel: identity.cik === "0000915913" ? "Total net sales" : "Consolidated net sales",
          omittedSubtotals: []
        },
        coverage: { ...p.coverage, segments: true }
      };
      if (!businessPeriod(next))
        throw Error("Original standalone business proof envelope did not validate.");
      if (identity.cik === "0000915913" && next.fiscalYear === 2016)
        next = enrichOriginalAlbemarleIncome(next, proof);
      next.coverage.sankey = !!flowPeriod(next);
      periods.push(next);
    } catch (error) {
      // An incomplete original scope may withhold a new comparative period. A
      // failing preserved candidate remains a failure; never silently replace it.
      if (prior || !(error instanceof OriginalStandaloneRevenueJoinError)) throw error;
      warnings.push(`${binding.id}: ${error.message}`);
    }
  }
  return { periods, warnings };
}
