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
/** Join only original visible physical cells to independently decoded XML facts.
 * No equal-value search across arbitrary scopes, no synthetic inline declarations,
 * no missing-as-zero, no currency conversion and no business/flow inference. */
export function readOriginalStandaloneRevenueRows(
  source: OriginalStandaloneSource,
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
    source.instanceUrl.endsWith(".xml") && !/<ix:nonFraction\b/i.test(source.primaryHtml),
    "Original separate documents must remain separate."
  );
  demand(
    new TextEncoder().encode(source.primaryHtml).length <= 24 * 1024 ** 2,
    "Oversized original primary document."
  );
  const instance = parseOriginalStandaloneXbrl(source.instanceXml, source.cik);
  const tables = [...source.primaryHtml.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  demand(
    tables.length <= 5000 && selections.length > 0 && selections.length <= 20,
    "Invalid original table selection."
  );
  // Read unmodified physical HTML cells. An empty inline fact set is intentional:
  // standalone evidence below has its own type, and is never assigned c.fact.
  const { grid } = originalRevenueGrid(
    source.primaryHtml,
    { facts: [], fiscalYear: 0, fiscalPeriod: "", periodEnd: "" },
    source.cik
  );
  const joins: ReturnType<typeof replayOriginalStandaloneRevenueTable>[] = [];
  const selectedTables = new Set<number>();
  for (const selection of selections) {
    demand(
      Number.isInteger(selection.tableIndex) &&
        selection.tableIndex >= 0 &&
        tables[selection.tableIndex] &&
        !selectedTables.has(selection.tableIndex),
      "Missing or duplicate original selected table."
    );
    selectedTables.add(selection.tableIndex);
    const t = tables[selection.tableIndex];
    const rowCount = [...t[0].matchAll(/<tr\b/gi)].length;
    const rows = grid(t[0], new Set(Array.from({ length: rowCount }, (_, i) => i)));
    joins.push(
      replayOriginalStandaloneRevenueTable(
        { cik: source.cik, instance },
        {
          tableIndex: selection.tableIndex,
          rows,
          precedingText: visibleText(
            source.primaryHtml.slice(Math.max(0, t.index! - 8000), t.index!)
          )
        },
        selection
      )
    );
  }
  const neededFacts = instance.facts.filter((f) =>
    selections.some((s) =>
      s.rows.some(
        (r) =>
          r.tag === f.tag &&
          f.context.start === s.period.startDate &&
          f.context.end === s.period.endDate &&
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
          f.context.start === s.period.startDate &&
          f.context.end === s.period.endDate &&
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
