/** Offline preparation from an acquired, source-hash-pinned attachment manifest.
 * Original XML decoding is not HTML/business/graph/cloud acceptance. */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, statfs, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { readSecCache } from "./sec-client";
import { parseOriginalStandaloneXbrl } from "./standalone-xbrl";

type Attachment = {
  sourceUrl: string;
  sha256: string;
  isOriginalXbrlInstance: boolean;
  declaredCiks: string[];
  localAcquisitionBoundBytes?: number;
};
type AcquiredSource = {
  key: string;
  ticker: string;
  cik: string;
  status: string;
  primarySourceSha256: string;
  filing: { accession: string; sourceUrl: string; directoryUrl: string };
  originalAttachments: Attachment[];
};
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const manifestPath = args[args.indexOf("--manifest") + 1];
if (!args.includes("--manifest") || !manifestPath)
  throw new Error("An acquired original-attachment --manifest is required.");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { rows: AcquiredSource[] };
if (!Array.isArray(manifest.rows)) throw new Error("Invalid acquired attachment manifest.");
const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const parserVersion = hash(await readFile(new URL("./standalone-xbrl.ts", import.meta.url)));
const directory = `.cache/finance/corpus/instances/${parserVersion}`;
await mkdir(directory, { recursive: true });
const rows: Record<string, unknown>[] = [];
const atomic = async (path: string, value: string | Buffer) => {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, value);
  await rename(temporary, path);
};
const index = () => ({
  schemaVersion: 1,
  parserVersion,
  manifestPath,
  preparedAt: new Date().toISOString(),
  scope:
    "Offline original XML declarations/resources only. No business partition, HTML row join, graph, runtime, cloud or all-company completion is asserted.",
  rows
});
for (const source of manifest.rows) {
  if (source.status !== "original-instance-acquired") continue;
  if (
    !/^\d{10}$/.test(source.cik) ||
    !/^[a-f0-9]{64}$/.test(source.primarySourceSha256) ||
    !/^\d{10}-\d{2}-\d{6}$/.test(source.filing.accession)
  )
    throw new Error("Invalid original source identity or hash.");
  const expected = `https://www.sec.gov/Archives/edgar/data/${Number(source.cik)}/${source.filing.accession.replaceAll("-", "")}/`;
  if (source.filing.directoryUrl !== expected || !source.filing.sourceUrl.startsWith(expected))
    throw new Error("Original primary source does not match its issuer and accession.");
  const disk = await statfs(directory);
  if (Number(disk.bavail) * Number(disk.bsize) < 3 * 1024 ** 3)
    throw new Error("Local preparation stopped before exhausting reserved disk space.");
  const primary = await readSecCache(source.filing.sourceUrl);
  if (!primary || hash(primary) !== source.primarySourceSha256)
    throw new Error("Original primary source differs from its acquired hash.");
  for (const a of source.originalAttachments) {
    if (!a.isOriginalXbrlInstance || !a.declaredCiks.some((c) => Number(c) === Number(source.cik)))
      continue;
    if (
      !a.sourceUrl.startsWith(expected) ||
      !/^[\w.-]+\.xml$/i.test(a.sourceUrl.slice(expected.length)) ||
      !/^[a-f0-9]{64}$/.test(a.sha256)
    )
      throw new Error("Invalid original XML attachment provenance.");
    try {
      const xml = await readSecCache(a.sourceUrl);
      if (!xml || hash(xml) !== a.sha256)
        throw new Error("Original XML differs from its acquired hash.");
      const instance = parseOriginalStandaloneXbrl(
        xml,
        source.cik,
        a.localAcquisitionBoundBytes ?? 64 * 1024 ** 2
      );
      // Shared resources remain separate instead of being copied into every fact.
      // INF is represented explicitly; JSON must not turn it into null.
      const ledger = {
        schemaVersion: 1,
        parserVersion,
        cik: source.cik,
        accession: source.filing.accession,
        primarySource: { url: source.filing.sourceUrl, sha256: source.primarySourceSha256 },
        originalInstanceSource: { url: a.sourceUrl, sha256: a.sha256 },
        originalRoot: instance.originalRoot,
        namespaces: instance.namespaces,
        contexts: instance.contexts,
        units: instance.units,
        metadata: instance.metadata,
        facts: instance.facts.map((f) => ({
          tag: f.tag,
          contextId: f.context.id,
          currency: f.currency,
          value: f.value,
          decimals: Number.isFinite(f.decimals) ? f.decimals : "INF",
          originalEvidence: {
            tag: f.originalEvidence.tag,
            contextId: f.originalEvidence.contextId,
            unitRef: f.originalEvidence.unitRef,
            lexical: f.originalEvidence.lexical,
            originalDecimals: f.originalEvidence.originalDecimals,
            originalPrecision: f.originalEvidence.originalPrecision,
            originalXml: f.originalEvidence.originalXml
          }
        })),
        nilFacts: instance.nilFacts.map(({ context, ...declaration }) => ({
          ...declaration,
          contextId: context.id
        })),
        scope:
          "Original source declarations only; interpreted business partitions and visible HTML joins remain unproved."
      };
      const body = JSON.stringify(ledger),
        path = `${directory}/${a.sha256}.json.gz`;
      await atomic(path, gzipSync(body));
      rows.push({
        key: source.key,
        ticker: source.ticker,
        cik: source.cik,
        sourceUrl: a.sourceUrl,
        sourceSha256: a.sha256,
        parserVersion,
        prepared: true,
        path,
        normalizedSha256: hash(body),
        originalMonetaryFacts: instance.facts.length,
        originalNilDeclarations: instance.nilFacts.length,
        contextCount: instance.contexts.length,
        unitCount: instance.units.length
      });
      console.log(
        `${source.ticker}: ${instance.facts.length} original monetary declarations, ${instance.nilFacts.length} original nil declarations prepared.`
      );
    } catch (e) {
      rows.push({
        key: source.key,
        ticker: source.ticker,
        cik: source.cik,
        sourceUrl: a.sourceUrl,
        sourceSha256: a.sha256,
        parserVersion,
        prepared: false,
        error: e instanceof Error ? e.message : String(e)
      });
      console.log(`${source.ticker}: original XML preparation withheld.`);
    }
  }
  await atomic(`${directory}/index.json`, JSON.stringify(index(), null, 2) + "\n");
}
const result = index();
const failed = rows.filter((row) => !row.prepared).length;
console.log(
  `Original XML preparation: ${rows.length - failed}/${rows.length}; failures ${failed}. Index: ${directory}/index.json`
);
if (!result.rows.length || failed) process.exitCode = 1;
