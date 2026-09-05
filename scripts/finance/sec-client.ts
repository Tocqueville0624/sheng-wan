import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  SEC_USER_AGENT as CONTACT,
  assertSecUrl,
  parseFilings,
  readBounded,
  type SecFiling,
  type Submissions
} from "./sec-shared";
export { assertSecUrl, type SecFiling } from "./sec-shared";

// The public contact email is explicitly authorized for sec.gov requests only.
const SEC_USER_AGENT = process.env.SEC_USER_AGENT ?? CONTACT;
const cacheDirectory = path.join(process.cwd(), ".cache", "finance", "sec");
let lastRequest = 0;

type CacheEntry = { url: string; fetchedAt: number; body: string };

export async function fetchSec(url: string, maxAgeMs = Infinity): Promise<string> {
  assertSecUrl(url);
  const cachePath = path.join(
    cacheDirectory,
    `${createHash("sha256").update(url).digest("hex")}.json`
  );
  if (!process.argv.includes("--force")) {
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf8")) as CacheEntry;
      if (cached.url === url && Date.now() - cached.fetchedAt < maxAgeMs) return cached.body;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  // Sequential caller plus this minimum spacing stays well below SEC's 10/s ceiling.
  const wait = Math.max(0, 550 - (Date.now() - lastRequest));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequest = Date.now();
  const response = await fetch(url, {
    headers: {
      "User-Agent": SEC_USER_AGENT,
      Accept: "application/json,text/html,application/xhtml+xml"
    },
    signal: AbortSignal.timeout(30_000),
    redirect: "manual"
  });
  if (!response.ok) throw new Error(`SEC HTTP ${response.status}: ${url}`);
  const body = await readBounded(response);
  if (body.includes("Your Request Originates from an Undeclared Automated Tool"))
    throw new Error(`SEC rejected crawler identification: ${url}`);
  await mkdir(cacheDirectory, { recursive: true });
  const temporary = `${cachePath}.${process.pid}.tmp`;
  await writeFile(
    temporary,
    JSON.stringify({ url, fetchedAt: Date.now(), body } satisfies CacheEntry)
  );
  await rename(temporary, cachePath);
  process.stdout.write(`Fetched SEC ${url}\n`);
  return body;
}

export async function companyFilings(cik: string): Promise<SecFiling[]> {
  const data = JSON.parse(
    await fetchSec(
      `https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`,
      60 * 60 * 1000
    )
  ) as Submissions;
  return parseFilings(cik, data.filings.recent);
}

export async function filingHtmlDocuments(filing: SecFiling): Promise<string[]> {
  const index = JSON.parse(await fetchSec(`${filing.directoryUrl}index.json`)) as {
    directory: { item: { name: string }[] };
  };
  return index.directory.item
    .filter((item) => /\.x?html?$/i.test(item.name) && !/^R\d+\.htm$/i.test(item.name))
    .map((item) => `${filing.directoryUrl}${item.name}`);
}
