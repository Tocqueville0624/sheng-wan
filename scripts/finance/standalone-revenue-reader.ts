import type { OriginalStandaloneSourceProof } from "../../src/features/finance/standalone-source-proof";
import { visibleText } from "./business-v2";
import { originalRevenueGrid } from "./original-revenue-grid";
import { parseOriginalStandaloneXbrl } from "./standalone-xbrl";
import {
  OriginalStandaloneRevenueJoinError,
  replayOriginalStandaloneRevenueTable,
  type OriginalStandaloneTableSelection
} from "../../src/features/finance/standalone-revenue-rows";
export { OriginalStandaloneRevenueJoinError } from "../../src/features/finance/standalone-revenue-rows";
export type { OriginalStandaloneTableSelection } from "../../src/features/finance/standalone-revenue-rows";

function demand(value: unknown, reason: string): asserts value {
  if (!value) throw new OriginalStandaloneRevenueJoinError(reason);
}
export type OriginalStandaloneSource = {
  cik: string;
  accession: string;
  primaryUrl: string;
  primaryHtml: string;
  instanceUrl: string;
  instanceXml: string;
};
export type OriginalStandalonePhysicalTable = Pick<
  OriginalStandaloneSourceProof["tables"][number],
  "tableIndex" | "rows" | "precedingText"
>;
export type PreparedOriginalStandaloneSource = Omit<OriginalStandaloneSource, "primaryHtml"> & {
  primaryTables: OriginalStandalonePhysicalTable[];
};
/** Join only original visible physical cells to independently decoded XML facts.
 * No equal-value search across arbitrary scopes, no synthetic inline declarations,
 * no missing-as-zero, no currency conversion and no business/flow inference. */
export function readOriginalStandalonePreparedRevenueRows(
  source: PreparedOriginalStandaloneSource,
  selections: OriginalStandaloneTableSelection[],
  sourceHashes: { primarySha256: string; instanceSha256: string }
) {
  demand(
    /^[a-f0-9]{64}$/.test(sourceHashes.primarySha256) &&
      /^[a-f0-9]{64}$/.test(sourceHashes.instanceSha256),
    "Missing original source hashes."
  );
  demand(
    /^\d{10}$/.test(source.cik) && /^\d{10}-\d{2}-\d{6}$/.test(source.accession),
    "Invalid original join identity."
  );
  const directory = `/Archives/edgar/data/${Number(source.cik)}/${source.accession.replaceAll("-", "")}/`;
  for (const url of [source.primaryUrl, source.instanceUrl]) {
    const u = new URL(url);
    demand(
      u.origin === "https://www.sec.gov" &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        u.pathname.startsWith(directory) &&
        /^[\w.-]+$/.test(u.pathname.slice(directory.length)),
      "Original documents do not share issuer and accession."
    );
  }
  demand(
    source.instanceUrl.endsWith(".xml") && source.instanceUrl !== source.primaryUrl,
    "Original separate documents must remain separate."
  );
  demand(
    source.primaryTables.length >= 1 &&
      source.primaryTables.length <= 20 &&
      new TextEncoder().encode(JSON.stringify(source.primaryTables)).length <= 262144,
    "Oversized original physical table state."
  );
  const instance = parseOriginalStandaloneXbrl(source.instanceXml, source.cik);
  const tables = new Map(source.primaryTables.map((t) => [t.tableIndex, t]));
  demand(
    tables.size === source.primaryTables.length &&
      tables.size === selections.length &&
      selections.length > 0 &&
      selections.length <= 20,
    "Invalid original table selection."
  );
  const joins: ReturnType<typeof replayOriginalStandaloneRevenueTable>[] = [];
  const selectedTables = new Set<number>();
  for (const selection of selections) {
    demand(
      Number.isInteger(selection.tableIndex) &&
        selection.tableIndex >= 0 &&
        tables.has(selection.tableIndex) &&
        !selectedTables.has(selection.tableIndex),
      "Missing or duplicate original selected table."
    );
    selectedTables.add(selection.tableIndex);
    joins.push(
      replayOriginalStandaloneRevenueTable(
        { cik: source.cik, instance },
        tables.get(selection.tableIndex)!,
        selection
      )
    );
  }
  const neededScope = (
    s: OriginalStandaloneTableSelection,
    start: string | undefined,
    end: string | undefined
  ) =>
    (start === s.period.startDate && end === s.period.endDate) ||
    (source.cik === "0000731766" &&
      s.scale === 6 &&
      s.headers.labels.some(
        (year) => /^[0-9]{4}$/.test(year) && start === `${year}-01-01` && end === `${year}-12-31`
      ));
  const neededFacts = instance.facts.filter((f) =>
    selections.some((s) =>
      s.rows.some(
        (r) =>
          r.tag === f.tag &&
          neededScope(s, f.context.start, f.context.end) &&
          JSON.stringify(Object.entries(f.context.dimensions).sort()) ===
            JSON.stringify(Object.entries(r.dimensions).sort())
      )
    )
  );
  const neededNils = instance.nilFacts.filter((f) =>
    selections.some((s) =>
      s.rows.some(
        (r) =>
          r.tag === f.tag &&
          neededScope(s, f.context.start, f.context.end) &&
          JSON.stringify(Object.entries(f.context.dimensions).sort()) ===
            JSON.stringify(Object.entries(r.dimensions).sort())
      )
    )
  );
  const contextIds = new Set([
    ...neededFacts.map((f) => f.context.id),
    ...neededNils.map((f) => f.context.id),
    ...instance.metadata.map((m) => m.contextId)
  ]);
  const unitIds = new Set([
    ...neededFacts.map((f) => f.originalEvidence.unitRef),
    ...neededNils.map((f) => f.unitRef)
  ]);
  const proof: OriginalStandaloneSourceProof = {
    format: "original-separate-xbrl-html-v1",
    cik: source.cik,
    accession: source.accession,
    primarySource: { url: source.primaryUrl, sha256: sourceHashes.primarySha256 },
    instanceSource: { url: source.instanceUrl, sha256: sourceHashes.instanceSha256 },
    originalXml: {
      root: instance.originalRoot,
      closingRoot: source.instanceXml.match(/<\/((?:[\w.-]+:)?xbrl)\s*>\s*$/)![0],
      contexts: instance.contexts.filter((c) => contextIds.has(c.id)).map((c) => c.originalXml),
      units: instance.units.filter((u) => unitIds.has(u.id)).map((u) => u.originalXml),
      declarations: [
        ...neededFacts.map((f) => f.originalEvidence.originalXml),
        ...neededNils.map((f) => f.originalXml)
      ],
      metadata: instance.metadata.map((m) => m.originalXml)
    },
    tables: joins.map((t) => ({
      tableIndex: t.tableIndex,
      rows: t.rows,
      precedingText: t.precedingText,
      selection: t.selection
    }))
  };
  return {
    proof,
    cik: source.cik,
    accession: source.accession,
    primarySource: { url: source.primaryUrl, sha256: sourceHashes.primarySha256 },
    instanceSource: { url: source.instanceUrl, sha256: sourceHashes.instanceSha256 },
    originalNamespaces: instance.namespaces,
    originalMetadata: instance.metadata,
    joins,
    scope:
      "Original XML/physical HTML joins only; complete business classification, financial flow and runtime acceptance remain separate."
  };
}

/** The offline facade and the queued importer replay the same physical tables.
 * Only these bounded normalized rows cross an alarm boundary; full HTML is not
 * serialized into a task or transformed into synthetic inline-XBRL facts. */
export function readOriginalStandaloneRevenueRows(
  source: OriginalStandaloneSource,
  selections: OriginalStandaloneTableSelection[],
  sourceHashes: { primarySha256: string; instanceSha256: string }
) {
  demand(
    !/<(?:[\w.-]+:)?nonFraction\b/i.test(source.primaryHtml),
    "Original separate documents must remain separate."
  );
  demand(
    new TextEncoder().encode(source.primaryHtml).length <= 24 * 1024 ** 2,
    "Oversized original primary document."
  );
  const tables = [...source.primaryHtml.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  demand(tables.length <= 5000, "Invalid original table selection.");
  const { grid } = originalRevenueGrid(
    source.primaryHtml,
    { facts: [], fiscalYear: 0, fiscalPeriod: "", periodEnd: "" },
    source.cik
  );
  const primaryTables = selections.map((s) => {
    const t = tables[s.tableIndex];
    demand(t, "Missing original selected table.");
    const rowCount = [...t[0].matchAll(/<tr\b/gi)].length;
    return {
      tableIndex: s.tableIndex,
      rows: grid(t[0], new Set(Array.from({ length: rowCount }, (_, i) => i))),
      precedingText: visibleText(source.primaryHtml.slice(Math.max(0, t.index! - 8000), t.index!))
    };
  });
  return readOriginalStandalonePreparedRevenueRows(
    { ...source, primaryTables },
    selections,
    sourceHashes
  );
}
