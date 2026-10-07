import type { SecFiling } from "./sec-shared";

/** Discover names from the actual same-accession directory response. This does
 * not infer an XML filename from a ticker, report date or primary document. */
export function originalStandaloneIndexUrl(cik: string, filing: SecFiling): string {
  if (!/^\d{10}$/.test(cik) || !/^\d{10}-\d{2}-\d{6}$/.test(filing.accession))
    throw Error("Invalid original standalone issuer or accession.");
  const directory = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accession.replaceAll("-", "")}/`;
  if (
    filing.directoryUrl !== directory ||
    filing.sourceUrl !== directory + filing.primaryDocument ||
    !/^[A-Za-z0-9_.-]+\.x?html?$/i.test(filing.primaryDocument)
  )
    throw Error("Original standalone directory does not match its filing.");
  return directory + "index.json";
}

export function originalStandaloneXmlUrls(
  indexJson: string,
  cik: string,
  filing: SecFiling
): string[] {
  originalStandaloneIndexUrl(cik, filing);
  if (new TextEncoder().encode(indexJson).byteLength > 4 * 1024 * 1024)
    throw Error("Original standalone directory response is too large.");
  const index = JSON.parse(indexJson) as {
    directory?: { name?: unknown; item?: { name?: unknown; type?: unknown }[] };
  };
  const expected = new URL(filing.directoryUrl).pathname.replace(/\/$/, "");
  if (
    typeof index.directory?.name !== "string" ||
    index.directory.name.replace(/\/$/, "") !== expected ||
    !Array.isArray(index.directory.item) ||
    index.directory.item.length > 5000
  )
    throw Error("Original standalone directory identity or entries are invalid.");
  const names = index.directory.item.map((item) => {
    if (typeof item.name !== "string" || !/^[A-Za-z0-9_.-]+$/.test(item.name))
      throw Error("Invalid original standalone attachment name.");
    return item.name;
  });
  if (new Set(names).size !== names.length)
    throw Error("Duplicate original standalone directory entries.");
  const candidates = names.filter(
    (name) =>
      /\.xml$/i.test(name) &&
      !/^(?:FilingSummary|MetaLinks|R\d+)\.xml$/i.test(name) &&
      !/(?:_cal|_def|_lab|_pre)\.xml$/i.test(name)
  );
  if (candidates.length > 4) throw Error("Ambiguous original standalone XML attachments.");
  return candidates.map((name) => filing.directoryUrl + name);
}
