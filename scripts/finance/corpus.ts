/**
 * Acquire every catalog issuer's real sources with per-issuer checkpoints.
 * pnpm data:corpus -- --all --download
 * pnpm data:corpus -- --all --audit  (offline; repeat after parser fixes)
 * Optional --tickers WMT,JNJ, --force, --retry-failed, --limit N.
 * Corpus and full datasets are local-only; this never mutates public storage.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import catalogData from "../../src/data/generated/finance-catalog.json" with { type: "json" };
import bundledData from "../../src/data/generated/finance-history.json" with { type: "json" };
import type { FinanceCatalog, PeriodV2, CompanyV2 } from "../../src/features/finance/v2-types";
import { auditCompanyDataset } from "./coverage-audit";
import { corpusAcceptance, corpusFilings, uniqueIssuers } from "./corpus-model";
import { extractFactsV2, parseFactsDocument } from "./facts-v2";
import { genericFilingTodo } from "./generic-import";
import { issuerSources } from "./issuer-sources";
import { fetchSec, readSecCache } from "./sec-client";

type SourceRecord = { url: string; bytes: number; sha256: string };
type IssuerRecord = {
  cik: string;
  ticker: string;
  tickers: string[];
  name: string;
  sector: string;
  reviewedAdapter: boolean;
  download: "pending" | "downloading" | "downloaded" | "partial" | "failed";
  analysis: "pending" | "complete" | "partial" | "failed";
  sourceRecords: SourceRecord[];
  filingTargets: ReturnType<typeof corpusFilings>;
  errors: string[];
  checkedAt?: string;
  parserVersion?: string;
  sourceVersion?: string;
  latestAnnual?: { id: string; sankey: boolean; segments: boolean };
  latestQuarter?: { id: string; sankey: boolean; segments: boolean };
  gaps?: string[];
};
type Corpus = {
  schemaVersion: 1;
  catalogHash: string;
  catalogAsOf: string;
  startedAt: string;
  updatedAt: string;
  securities: number;
  issuers: IssuerRecord[];
};

const catalog = catalogData as FinanceCatalog;
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const option = (name: string) => args[args.indexOf(name) + 1];
const audit = args.includes("--audit");
const force = args.includes("--force");
const limit = args.includes("--limit") ? Number(option("--limit")) : Infinity;
if (!args.includes("--all") && !args.includes("--tickers"))
  throw new Error("Select --all or --tickers TICKER,TICKER.");
if (!(limit > 0) || (limit !== Infinity && !Number.isInteger(limit)))
  throw new Error("Invalid --limit.");
const directory = path.join(process.cwd(), ".cache/finance/corpus");
const destination = path.join(directory, "inventory.json");
await mkdir(path.join(directory, "companies"), { recursive: true });
await mkdir(path.join(directory, "analysis"), { recursive: true });
const hash = (body: string) => createHash("sha256").update(body).digest("hex");
const catalogHash = hash(JSON.stringify(catalog));
const atomicJson = async (file: string, value: unknown) => {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n");
  await rename(temporary, file);
};
let corpus: Corpus;
try {
  corpus = JSON.parse(await readFile(destination, "utf8")) as Corpus;
  if (corpus.catalogHash !== catalogHash)
    throw new Error("Corpus catalog differs; review inventory.");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  const reviewed = new Set(bundledData.companies.map((c) => c.cik));
  corpus = {
    schemaVersion: 1,
    catalogHash,
    catalogAsOf: catalog.asOf,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    securities: catalog.companies.length,
    issuers: uniqueIssuers(catalog.companies).map(({ identity, tickers }) => ({
      ...identity,
      tickers,
      reviewedAdapter: reviewed.has(identity.cik),
      download: "pending",
      analysis: "pending",
      sourceRecords: [],
      filingTargets: [],
      errors: []
    }))
  };
}
const persist = async () => {
  corpus.updatedAt = new Date().toISOString();
  await atomicJson(destination, corpus);
};
if (!audit) await persist();
const selected = args.includes("--tickers") ? new Set(option("--tickers").split(",")) : undefined;
if (selected)
  for (const ticker of selected)
    if (!corpus.issuers.some((c) => c.tickers.includes(ticker)))
      throw new Error(`Unknown corpus ticker: ${ticker}`);
const parserFiles = [
  "generic-import",
  "business-v2",
  "business-matrix",
  "statement-v2",
  "facts-v2",
  "inline-v2",
  "ixbrl",
  "v2-model",
  "validate",
  "coverage-audit",
  "issuer-sources",
  "reviewed-business",
  "corpus-model"
];
const parserVersion = hash(
  (
    await Promise.all([
      ...parserFiles.map((name) => readFile(`scripts/finance/${name}.ts`, "utf8")),
      readFile("src/features/finance/business-rules.ts", "utf8"),
      readFile("src/features/finance/chart-model.ts", "utf8"),
      readFile("src/data/generated/finance-history.json", "utf8")
    ])
  ).join("\n")
);
let processed = 0;
for (const entry of corpus.issuers) {
  if (selected && !entry.tickers.some((ticker) => selected.has(ticker))) continue;
  if (processed >= limit) break;
  const identity = catalog.companies.find((c) => c.cik === entry.cik)!;
  if (audit) {
    const sourceVersion = hash(
      JSON.stringify({
        download: entry.download,
        sources: entry.sourceRecords,
        targets: entry.filingTargets
      })
    );
    const analysisPath = path.join(directory, "analysis", `${entry.cik}.json`);
    try {
      Object.assign(entry, JSON.parse(await readFile(analysisPath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (entry.download !== "downloaded" && entry.download !== "partial") continue;
    if (
      !force &&
      entry.parserVersion === parserVersion &&
      entry.sourceVersion === sourceVersion &&
      entry.analysis !== "pending"
    )
      continue;
    processed++;
    try {
      const source = async (url: string) => {
        const cached = await readSecCache(url);
        if (cached === undefined) throw new Error(`Unacquired source: ${url}`);
        return cached;
      };
      const seed = bundledData.companies.find((c) => c.cik === entry.cik) as CompanyV2 | undefined;
      const result = await auditCompanyDataset(identity, source, 30, seed);
      const capability = (p: PeriodV2 | undefined) =>
        p && { id: p.id, sankey: p.coverage.sankey, segments: p.coverage.segments };
      entry.latestAnnual = capability(result.company.annual.at(-1));
      entry.latestQuarter = capability(result.company.quarterly.at(-1));
      const acceptance = corpusAcceptance(
        result.company,
        entry.filingTargets,
        entry.download,
        result.report.warnings ?? []
      );
      entry.analysis = acceptance.complete ? "complete" : "partial";
      entry.gaps = acceptance.gaps;
      entry.parserVersion = parserVersion;
      entry.sourceVersion = sourceVersion;
      await atomicJson(path.join(directory, "companies", `${entry.cik}.json`), result);
      process.stdout.write(
        `${entry.ticker} parsed: Sankey ${result.report.sankey}; business ${result.report.segments}\n`
      );
    } catch (error) {
      entry.analysis = "failed";
      entry.parserVersion = parserVersion;
      entry.sourceVersion = sourceVersion;
      entry.errors.push(`audit: ${error instanceof Error ? error.message : error}`);
      process.stdout.write(`${entry.ticker} audit failed: ${entry.errors.at(-1)}\n`);
    }
    // Analysis has its own checkpoint: it can run while the download process
    // updates inventory.json without either process overwriting the other's work.
    await atomicJson(analysisPath, {
      analysis: entry.analysis,
      parserVersion: entry.parserVersion,
      sourceVersion: entry.sourceVersion,
      latestAnnual: entry.latestAnnual,
      latestQuarter: entry.latestQuarter,
      gaps: entry.gaps,
      auditErrors: entry.errors.filter((e) => e.startsWith("audit:")),
      analyzedAt: new Date().toISOString()
    });
  } else {
    if (!force && entry.download === "downloaded") continue;
    if (!force && !args.includes("--retry-failed") && entry.download === "failed") continue;
    const disk = await statfs(directory);
    if (disk.bavail * disk.bsize < 3 * 1024 ** 3)
      throw new Error("Less than 3 GiB free; corpus checkpoint retained.");
    processed++;
    entry.download = "downloading";
    entry.errors = [];
    entry.sourceRecords = [];
    await persist();
    const source = async (url: string, maxAge?: number) => {
      // Offline corpus acquisition has a larger explicit bound than the public
      // Worker. Oversized joint-registrant sources remain recorded for review.
      const body = await fetchSec(url, maxAge, 64 * 1024 * 1024);
      entry.sourceRecords.push({ url, bytes: Buffer.byteLength(body), sha256: hash(body) });
      return body;
    };
    try {
      const acquired = await issuerSources(identity, source);
      let supplement: ReturnType<typeof corpusFilings> = [];
      try {
        const facts = parseFactsDocument(acquired.factsSource);
        const basic = extractFactsV2(
          facts,
          identity,
          acquired.filings,
          undefined,
          acquired.submissions.sic
        );
        supplement = genericFilingTodo(
          basic,
          [...basic.annual, ...basic.quarterly],
          acquired.filings
        );
      } catch (error) {
        entry.errors.push(`standard-facts: ${error instanceof Error ? error.message : error}`);
      }
      entry.filingTargets = corpusFilings(acquired.filings, supplement);
      for (const filing of entry.filingTargets) {
        try {
          await source(filing.sourceUrl);
        } catch (error) {
          entry.errors.push(
            `${filing.accession}: ${error instanceof Error ? error.message : error}`
          );
        }
        await persist();
      }
      entry.download = entry.errors.length ? "partial" : "downloaded";
    } catch (error) {
      entry.download = "failed";
      entry.errors.push(error instanceof Error ? error.message : String(error));
    }
    entry.checkedAt = new Date().toISOString();
    const done = corpus.issuers.filter(
      (c) => c.download === "downloaded" || c.download === "partial"
    ).length;
    process.stdout.write(
      `${entry.ticker} ${entry.download}; ${entry.filingTargets.length} filings; acquired issuers ${done}/${corpus.issuers.length}\n`
    );
  }
  if (!audit) await persist();
}
const count = (key: "download" | "analysis", value: string) =>
  corpus.issuers.filter((c) => c[key] === value).length;
process.stdout.write(
  JSON.stringify(
    {
      issuers: corpus.issuers.length,
      processed,
      downloaded: count("download", "downloaded"),
      partialDownload: count("download", "partial"),
      failedDownload: count("download", "failed"),
      fullyParsed: count("analysis", "complete"),
      partialParsed: count("analysis", "partial"),
      failedAnalysis: count("analysis", "failed"),
      inventory: destination
    },
    null,
    2
  ) + "\n"
);
