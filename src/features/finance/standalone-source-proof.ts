import { parseOriginalStandaloneXbrl } from "../../../scripts/finance/standalone-xbrl";
import type { ServiceRevenueRow } from "./types";
import {
  OriginalStandaloneRevenueJoinError,
  replayOriginalStandaloneRevenueTable,
  type OriginalStandaloneTableSelection
} from "./standalone-revenue-rows";

/** Only unchanged original XML fragments and normalized physical HTML cells.
 * No full filing HTML, fictitious inline declaration or mutable parsed amount is
 * needed to revalidate a saved original-source join. Issuer meanings remain a
 * separate proof layer. */
export type OriginalStandaloneSourceProof = {
  format: "original-separate-xbrl-html-v1";
  cik: string;
  accession: string;
  primarySource: { url: string; sha256: string };
  instanceSource: { url: string; sha256: string };
  originalXml: {
    root: string;
    closingRoot: string;
    contexts: string[];
    units: string[];
    declarations: string[];
    metadata: string[];
  };
  tables: {
    tableIndex: number;
    rows: ServiceRevenueRow[];
    precedingText: string;
    selection: OriginalStandaloneTableSelection;
  }[];
};
function demand(value: unknown, reason: string): asserts value {
  if (!value) throw new OriginalStandaloneRevenueJoinError(reason);
}
/** Decode the actual declarations again, instead of trusting cached parsed facts.
 * Copied original root/resources/declarations form a bounded source excerpt;
 * original financial strings are never created, renamed or rescaled here. */
export function replayOriginalStandaloneSourceProof(proof: OriginalStandaloneSourceProof) {
  demand(
    proof.format === "original-separate-xbrl-html-v1" &&
      /^\d{10}$/.test(proof.cik) &&
      Number(proof.cik) > 0 &&
      /^\d{10}-\d{2}-\d{6}$/.test(proof.accession),
    "Invalid original standalone proof identity."
  );
  const directory = `/Archives/edgar/data/${Number(proof.cik)}/${proof.accession.replaceAll("-", "")}/`;
  for (const source of [proof.primarySource, proof.instanceSource]) {
    const u = new URL(source.url);
    demand(
      u.origin === "https://www.sec.gov" &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        u.pathname.startsWith(directory) &&
        /^[\w.-]+$/.test(u.pathname.slice(directory.length)) &&
        /^[a-f0-9]{64}$/.test(source.sha256),
      "Foreign or unpinned original standalone proof source."
    );
  }
  demand(
    proof.instanceSource.url.endsWith(".xml") &&
      proof.primarySource.url !== proof.instanceSource.url,
    "Original XML and primary sources must remain distinct."
  );
  const x = proof.originalXml;
  demand(
    typeof x.root === "string" &&
      typeof x.closingRoot === "string" &&
      Array.isArray(x.contexts) &&
      x.contexts.length > 0 &&
      x.contexts.length <= 100 &&
      Array.isArray(x.units) &&
      x.units.length > 0 &&
      x.units.length <= 20 &&
      Array.isArray(x.declarations) &&
      x.declarations.length > 0 &&
      x.declarations.length <= 100 &&
      Array.isArray(x.metadata) &&
      x.metadata.length <= 12,
    "Invalid original standalone proof resources."
  );
  const fragments = [...x.contexts, ...x.units, ...x.declarations, ...x.metadata];
  demand(
    fragments.every((s) => typeof s === "string" && s.length > 0 && s.length <= 262144) &&
      new Set(fragments).size === fragments.length,
    "Duplicate or invalid original proof fragments."
  );
  const xml = [x.root, ...fragments, x.closingRoot].join("\n");
  const instance = parseOriginalStandaloneXbrl(xml, proof.cik, 262144);
  // Selected source fragments may not quietly rebind the QName namespaces used
  // to establish currency and business meaning. Unknown scopes stay unreviewed.
  for (const fragment of fragments) {
    for (const m of fragment.matchAll(/\bxmlns(?::([\w.-]+))?\s*=\s*(["'])(.*?)\2/g))
      demand(instance.namespaces[m[1] ?? ""] === m[3], "Rebound original proof namespace.");
  }
  demand(
    instance.contexts.length === x.contexts.length &&
      instance.units.length === x.units.length &&
      instance.facts.length + instance.nilFacts.length === x.declarations.length &&
      instance.metadata.length === x.metadata.length,
    "Original proof fragment roles differ from declarations."
  );
  demand(
    Array.isArray(proof.tables) &&
      proof.tables.length >= 1 &&
      proof.tables.length <= 20 &&
      new Set(proof.tables.map((t) => t.tableIndex)).size === proof.tables.length,
    "Duplicate or missing original proof tables."
  );
  const joins = proof.tables.map((t) =>
    replayOriginalStandaloneRevenueTable({ cik: proof.cik, instance }, t, t.selection)
  );
  return { instance, joins };
}
