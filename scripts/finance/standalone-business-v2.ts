import type { CatalogCompany, CompanyV2, PeriodV2 } from "../../src/features/finance/v2-types";
import {
  originalStandaloneBusinessSelections,
  originalStandaloneBusinessSegments,
  originalStandaloneBusinessBasis,
  type OriginalStandaloneBusinessProof
} from "../../src/features/finance/standalone-business";
import { parseOriginalStandaloneXbrl } from "./standalone-xbrl";
import { originalRevenueGrid } from "./original-revenue-grid";
import { readOriginalStandaloneRevenueRows } from "./standalone-revenue-reader";
import { visibleText } from "./business-v2";
import { businessPeriod, flowPeriod } from "./v2-model";
import type { SecFiling } from "./sec-shared";
const hash = async (s: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))),
    (b) => b.toString(16).padStart(2, "0")
  ).join("");

export function originalStandaloneBusinessRequired(
  identity: CatalogCompany,
  filing: SecFiling,
  base: CompanyV2 | undefined,
  fresh: PeriodV2[] = []
): boolean {
  return (
    ["0000915913", "0001037868"].includes(identity.cik) &&
    /^10-K(?:\/A)?$/.test(filing.form) &&
    filing.reportDate === "2018-12-31" &&
    [...(base?.annual ?? []), ...fresh].some(
      (p) =>
        !p.coverage.segments &&
        p.kind === "annual" &&
        p.sourceUrl === filing.sourceUrl &&
        p.accession === filing.accession &&
        p.filedAt === filing.filedAt &&
        p.fiscalYear >= 2016 &&
        p.fiscalYear <= 2018
    )
  );
}
/** The caller supplies the actual acquired XML from this filing's SEC directory.
 * No guessed XML names, source fetches, cache writes or manufactured HTML occur. */
export async function readOriginalStandaloneBusinessFiling(
  html: string,
  xml: string,
  instanceUrl: string,
  identity: CatalogCompany,
  filing: SecFiling,
  base: CompanyV2 | undefined,
  fresh: PeriodV2[] = []
): Promise<PeriodV2[]> {
  if (!originalStandaloneBusinessRequired(identity, filing, base, fresh)) return [];
  const instance = parseOriginalStandaloneXbrl(xml, identity.cik);
  const fiscal = instance.metadata.filter((m) => m.tag === "dei:DocumentFiscalYearFocus"),
    end = instance.metadata.filter((m) => m.tag === "dei:DocumentPeriodEndDate");
  if (
    fiscal.length !== 1 ||
    end.length !== 1 ||
    Number(fiscal[0].lexical) !== 2018 ||
    end[0].lexical !== filing.reportDate
  )
    return [];
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  if (tables.length > 5000) throw Error("Too many original standalone tables.");
  const { grid } = originalRevenueGrid(
    html,
    { facts: [], fiscalYear: 0, fiscalPeriod: "", periodEnd: "" },
    identity.cik
  );
  const layouts = tables.flatMap((t, tableIndex) => {
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
        before: visibleText(html.slice(Math.max(0, t.index! - 8000), t.index!))
      }
    ];
  });
  const label = (t: (typeof layouts)[number], i: number) => t.rows[i]?.cells[0]?.label;
  const primary = layouts.filter((t) =>
    identity.cik === "0000915913"
      ? label(t, 4) === "Net sales" &&
        label(t, 15) === "Income tax expense" &&
        /Albemarle Corporation and Subsidiaries CONSOLIDATED STATEMENTS OF INCOME$/.test(t.before)
      : label(t, 3) === "Net sales" &&
        label(t, 16) === "Provision for income taxes" &&
        t.before.endsWith(
          "Consolidated Statement of Income (In thousands, except per share amounts)"
        )
  );
  if (primary.length !== 1) return [];
  const sourceHashes = { primarySha256: await hash(html), instanceSha256: await hash(xml) };
  const candidates = new Map((base?.annual ?? []).map((p) => [p.id, p]));
  for (const p of fresh) {
    const prior = candidates.get(p.id);
    // Same-filing basic candidates must not discard already validated statement
    // details before adding an independently verified business partition.
    if (p.kind === "annual" && (!prior || p.filedAt > prior.filedAt)) candidates.set(p.id, p);
  }
  const output: PeriodV2[] = [];
  for (const p of candidates.values()) {
    if (
      p.coverage.segments ||
      p.kind !== "annual" ||
      p.sourceUrl !== filing.sourceUrl ||
      p.accession !== filing.accession ||
      p.filedAt !== filing.filedAt ||
      p.fiscalYear < 2016 ||
      p.fiscalYear > 2018
    )
      continue;
    const businesses = layouts.filter((t) =>
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
            .join("") === String(p.fiscalYear)
    );
    if (businesses.length !== 1) continue;
    const source = readOriginalStandaloneRevenueRows(
      {
        cik: identity.cik,
        accession: filing.accession,
        primaryUrl: filing.sourceUrl,
        primaryHtml: html,
        instanceUrl,
        instanceXml: xml
      },
      originalStandaloneBusinessSelections(
        identity.cik,
        2018,
        p.fiscalYear,
        primary[0].tableIndex,
        businesses[0].tableIndex
      ),
      sourceHashes
    );
    const proof: OriginalStandaloneBusinessProof = {
      ruleId:
        identity.cik === "0000915913"
          ? "alb-original-separate-revenue-v1"
          : "ame-original-separate-closing-sales-v1",
      reportDate: filing.reportDate,
      form: filing.form,
      source: source.proof
    };
    const next: PeriodV2 = {
      ...p,
      segments: originalStandaloneBusinessSegments(p, proof),
      segmentSourceUrl: p.sourceUrl,
      segmentBasis: originalStandaloneBusinessBasis(proof.ruleId),
      businessBreakdownSource: {
        method: "reviewed-original-standalone-revenue",
        standaloneRevenue: proof,
        ruleId: proof.ruleId,
        tableIndex: businesses[0].tableIndex,
        totalTableIndex: primary[0].tableIndex,
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
    next.coverage.sankey = !!flowPeriod(next);
    output.push(next);
  }
  return output;
}
