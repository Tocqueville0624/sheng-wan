import { describe, expect, it } from "vitest";
import {
  originalStandaloneIndexUrl,
  originalStandaloneXmlUrls
} from "../scripts/finance/standalone-source-index";
import {
  readPinnedCorpusSource,
  registerCachedOriginalStandaloneSources,
  type CorpusSourceRecord
} from "../scripts/finance/corpus-source-records";
import { createHash } from "node:crypto";
import type { SecFiling } from "../scripts/finance/sec-shared";

const cik = "0001037868";
const directory = "https://www.sec.gov/Archives/edgar/data/1037868/000119312519046947/";
const filing: SecFiling = {
  accession: "0001193125-19-046947",
  filedAt: "2019-02-21",
  reportDate: "2018-12-31",
  form: "10-K",
  primaryDocument: "d640432d10k.htm",
  directoryUrl: directory,
  sourceUrl: directory + "d640432d10k.htm"
};
const index = (names = ["ame-20181231.xml", "ame-20181231_cal.xml", "FilingSummary.xml"]) =>
  JSON.stringify({
    directory: {
      name: new URL(directory).pathname.replace(/\/$/, ""),
      item: names.map((name) => ({ name }))
    }
  });
const pin = (url: string, body: string): CorpusSourceRecord => ({
  url,
  bytes: Buffer.byteLength(body),
  sha256: createHash("sha256").update(body).digest("hex")
});
describe("original standalone attachment identity and corpus inventory", () => {
  it("uses the original directory's actual filename and excludes linkbases", () => {
    expect(originalStandaloneIndexUrl(cik, filing)).toBe(directory + "index.json");
    expect(originalStandaloneXmlUrls(index(), cik, filing)).toEqual([
      directory + "ame-20181231.xml"
    ]);
  });
  it.each([
    { ...filing, directoryUrl: directory.replace("1037868", "915913") },
    { ...filing, accession: "0001193125-19-046948" },
    { ...filing, sourceUrl: "https://example.org/d640432d10k.htm" },
    { ...filing, primaryDocument: "../d640432d10k.htm" }
  ])("rejects foreign issuer, accession, origin and path", (bad) => {
    expect(() => originalStandaloneIndexUrl(cik, bad)).toThrow();
  });
  it("does not invent an instance when the index has only linkbases", () => {
    expect(originalStandaloneXmlUrls(index(["ame-20181231_cal.xml"]), cik, filing)).toEqual([]);
  });
  it.each([["ame.xml", "ame.xml"], ["../ame.xml"], ["a.xml", "b.xml", "c.xml", "d.xml", "e.xml"]])(
    "withholds unsafe or ambiguous directory entries",
    (...names) => {
      expect(() => originalStandaloneXmlUrls(index(names), cik, filing)).toThrow();
    }
  );
  it("rejects a directory response describing a different accession", () => {
    expect(() =>
      originalStandaloneXmlUrls(
        index().replace("000119312519046947", "000119312519046948"),
        cik,
        filing
      )
    ).toThrow();
  });
  it("registers physically cached attachments and preserves original body fingerprints", async () => {
    const html = "original standalone HTML",
      xml = "original XML body";
    const files = new Map([
      [filing.sourceUrl, html],
      [directory + "index.json", index()],
      [directory + "ame-20181231.xml", xml]
    ]);
    const read = async (url: string) => files.get(url);
    const original = [pin(filing.sourceUrl, html)];
    const additions = await registerCachedOriginalStandaloneSources(cik, filing, original, read);
    expect(additions).toEqual([
      pin(directory + "index.json", index()),
      pin(directory + "ame-20181231.xml", xml)
    ]);
    expect(original).toEqual([pin(filing.sourceUrl, html)]);
    await expect(
      readPinnedCorpusSource(directory + "ame-20181231.xml", [...original, ...additions], read)
    ).resolves.toBe(xml);
    await expect(
      registerCachedOriginalStandaloneSources(cik, filing, [...original, ...additions], read)
    ).resolves.toEqual([]);
  });
  it("cannot audit an unregistered cached body or a body changed after acquisition", async () => {
    const url = directory + "ame-20181231.xml";
    await expect(readPinnedCorpusSource(url, [], async () => "actual cached body")).rejects.toThrow(
      "Unregistered"
    );
    await expect(
      readPinnedCorpusSource(url, [pin(url, "original")], async () => "changed")
    ).rejects.toThrow("fingerprint");
    await expect(
      readPinnedCorpusSource(url, [pin(url, "original"), pin(url, "other")], async () => "original")
    ).rejects.toThrow("conflicting");
  });
  it("does not overwrite a previously pinned attachment after a source change", async () => {
    const records = [pin(filing.sourceUrl, "HTML"), pin(directory + "index.json", index())];
    await expect(
      registerCachedOriginalStandaloneSources(cik, filing, records, async (url) =>
        url === filing.sourceUrl ? "HTML" : index(["other.xml"])
      )
    ).rejects.toThrow("fingerprint changed");
  });
});
