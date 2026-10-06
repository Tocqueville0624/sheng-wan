/** Publish normalized actual SEC data only after source and rendered/export checks. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { validateV2 } from "./v2-model";
import type { CompanyResponse, FinanceCatalog } from "../../src/features/finance/v2-types";
import catalogData from "../../src/data/generated/finance-catalog.json" with { type: "json" };

const args = process.argv.slice(2).filter((value) => value !== "--");
const option = (name: string) => args[args.indexOf(name) + 1];
for (const name of ["--ticker", "--input", "--source-proof", "--browser-proof"])
  if (!args.includes(name) || !option(name)) throw new Error(`Missing ${name}.`);
const identity = (catalogData as FinanceCatalog).companies.find(
  (c) => c.ticker === option("--ticker")
);
if (!identity) throw new Error("Ticker is not in the reviewed SEC catalog.");
const response = JSON.parse(await readFile(option("--input"), "utf8")) as CompanyResponse;
const company = response.company;
if (
  !company ||
  company.cik !== identity.cik ||
  !company.checkedAt ||
  response.job?.cik !== identity.cik ||
  !["ready", "partial", "unchanged"].includes(response.job.state)
)
  throw new Error("A completed actual SEC company response is required.");
validateV2(company);
const sources = JSON.parse(await readFile(option("--source-proof"), "utf8")) as {
  ticker: string;
  id: string;
  sourceUrl: string;
  realSecImport: boolean;
}[];
const browsers = JSON.parse(await readFile(option("--browser-proof"), "utf8")) as {
  ticker: string;
  id: string;
  realSecImport: boolean;
  proportionChecks: boolean;
  signedSourceProof: boolean;
  svg: boolean;
  png: boolean;
  csv: boolean;
}[];
const periods = [...company.annual, ...company.quarterly];
if (
  !sources.length ||
  sources.some(
    (source) =>
      source.ticker !== identity.ticker ||
      !source.realSecImport ||
      !periods.some((period) => period.id === source.id && period.sourceUrl === source.sourceUrl)
  ) ||
  !browsers.length ||
  browsers.some(
    (browser) =>
      browser.ticker !== identity.ticker ||
      !browser.realSecImport ||
      !browser.proportionChecks ||
      !browser.signedSourceProof ||
      !browser.svg ||
      !browser.png ||
      !browser.csv
  )
)
  throw new Error("Actual source and rendered/export acceptance evidence is required.");
for (const kind of ["annual", "quarterly"] as const) {
  const latest = company[kind].at(-1);
  if (
    !latest?.coverage.sankey ||
    !latest.coverage.segments ||
    !sources.some((source) => source.id === latest.id) ||
    !browsers.some((browser) => browser.id === latest.id)
  )
    throw new Error("Current annual and quarterly business/flow evidence is required.");
}
const directory = "src/data/generated/finance-reviewed";
const indexPath = "src/data/generated/finance-reviewed-snapshots.json";
const index = JSON.parse(await readFile(indexPath, "utf8")) as {
  cik: string;
  sha256: string;
  checkedAt: string;
}[];
const body = JSON.stringify(company);
const entry = {
  cik: identity.cik,
  sha256: createHash("sha256").update(body).digest("hex"),
  checkedAt: company.checkedAt
};
const nextIndex = [...index.filter((item) => item.cik !== identity.cik), entry].sort((a, b) =>
  a.cik.localeCompare(b.cik)
);
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/${identity.cik}.json`, JSON.stringify(company, null, 2) + "\n");
await writeFile(indexPath, JSON.stringify(nextIndex, null, 2) + "\n");
console.log(
  `${identity.ticker}: source-validated saved statements written; original source-check timestamp retained.`
);
