import { createHash } from "node:crypto";
import { writeFile, rename } from "node:fs/promises";
import type { CatalogCompany, FinanceCatalog } from "../../src/features/finance/v2-types";
import { SEC_USER_AGENT, readBounded } from "./sec-shared";

const sourceUrl = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";
const response = await fetch(sourceUrl, {
  headers: { "User-Agent": "AcademicWebsite/1.0" },
  redirect: "error"
});
if (!response.ok) throw new Error(`Constituent source HTTP ${response.status}`);
const html = await response.text();
const table = html.match(/<table\b[^>]*id="constituents"[\s\S]*?<\/table>/)?.[0];
if (!table) throw new Error("Constituent table missing; existing catalog unchanged.");
const clean = (value: string) =>
  value
    .replace(/<[^>]*>/g, "")
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
const companies: CatalogCompany[] = [];
for (const row of table.matchAll(/<tr\b[\s\S]*?<\/tr>/g)) {
  const cells = [...row[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => clean(cell[1]));
  if (cells.length < 8) continue;
  const [ticker, name, sector] = cells;
  const cik = cells[6].padStart(10, "0");
  if (!/^[A-Z0-9.-]{1,12}$/.test(ticker) || !/^\d{10}$/.test(cik))
    throw new Error("Invalid constituent identity");
  companies.push({ ticker, name, cik, sector, universe: "sp500" });
}
if (
  companies.length < 490 ||
  companies.length > 520 ||
  new Set(companies.map((c) => c.ticker)).size !== companies.length
)
  throw new Error("Unexpected constituent count; existing catalog unchanged.");
companies.push({
  ticker: "TSM",
  name: "TSMC",
  cik: "0001046179",
  sector: "Information Technology",
  universe: "additional"
});
const mappingUrl = "https://www.sec.gov/files/company_tickers.json";
const mappingText = await readBounded(
  await fetch(mappingUrl, {
    headers: { "User-Agent": SEC_USER_AGENT },
    redirect: "manual",
    signal: AbortSignal.timeout(25000)
  }),
  4 * 1024 * 1024
);
const mapping = new Map(
  Object.values(JSON.parse(mappingText) as Record<string, { cik_str: number; ticker: string }>).map(
    (c) => [c.ticker.replace("-", "."), String(c.cik_str).padStart(10, "0")]
  )
);
for (const company of companies) {
  if (mapping.get(company.ticker) !== company.cik)
    throw new Error(
      `${company.ticker}: public list and SEC ticker mapping disagree; prior catalog retained.`
    );
}
const catalog: FinanceCatalog = {
  schemaVersion: 2,
  asOf: new Date().toISOString(),
  sourceUrl,
  sourceHash: createHash("sha256").update(table).digest("hex"),
  secMapping: {
    sourceUrl: mappingUrl,
    checkedAt: new Date().toISOString(),
    sourceHash: createHash("sha256").update(mappingText).digest("hex")
  },
  companies
};
const destination = "src/data/generated/finance-catalog.json";
await writeFile(`${destination}.tmp`, JSON.stringify(catalog, null, 2) + "\n");
await rename(`${destination}.tmp`, destination);
console.log(
  `Saved ${companies.length} securities; CIK is verified against SEC Submissions on import. Source: ${sourceUrl}`
);
