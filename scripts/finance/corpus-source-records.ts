import { createHash } from "node:crypto";
import type { SecFiling } from "./sec-shared";
import { originalStandaloneIndexUrl, originalStandaloneXmlUrls } from "./standalone-source-index";

export type CorpusSourceRecord = { url: string; bytes: number; sha256: string };
const record = (url: string, body: string): CorpusSourceRecord => ({
  url,
  bytes: Buffer.byteLength(body),
  sha256: createHash("sha256").update(body).digest("hex")
});

export async function readPinnedCorpusSource(
  url: string,
  records: CorpusSourceRecord[],
  read: (url: string) => Promise<string | undefined>
): Promise<string> {
  const pins = records.filter((r) => r.url === url);
  if (!pins.length || pins.some((p) => p.sha256 !== pins[0].sha256 || p.bytes !== pins[0].bytes))
    throw Error(`Unregistered or conflicting corpus source: ${url}`);
  const body = await read(url);
  if (body === undefined) throw Error(`Unacquired corpus source: ${url}`);
  const actual = record(url, body);
  if (actual.sha256 !== pins[0].sha256 || actual.bytes !== pins[0].bytes)
    throw Error(`Corpus source differs from its acquisition fingerprint: ${url}`);
  return body;
}

/** Register only physically cached, same-accession attachment names disclosed
 * by the cached SEC index. This is acquisition inventory, not parsing approval. */
export async function registerCachedOriginalStandaloneSources(
  cik: string,
  filing: SecFiling,
  records: CorpusSourceRecord[],
  read: (url: string) => Promise<string | undefined>
): Promise<CorpusSourceRecord[]> {
  const html = await readPinnedCorpusSource(filing.sourceUrl, records, read);
  if (/<(?:[\w.-]+:)?nonFraction\b/i.test(html)) return [];
  const indexUrl = originalStandaloneIndexUrl(cik, filing);
  const index = await read(indexUrl);
  if (index === undefined) return [];
  const additions = [record(indexUrl, index)];
  for (const url of originalStandaloneXmlUrls(index, cik, filing)) {
    const xml = await read(url);
    if (xml !== undefined) additions.push(record(url, xml));
  }
  for (const addition of additions) {
    const prior = records.filter((r) => r.url === addition.url);
    if (prior.some((r) => r.sha256 !== addition.sha256 || r.bytes !== addition.bytes))
      throw Error(`Original standalone attachment fingerprint changed: ${addition.url}`);
  }
  return additions.filter((a) => !records.some((r) => r.url === a.url));
}
