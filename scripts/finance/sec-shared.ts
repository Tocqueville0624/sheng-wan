export const SEC_USER_AGENT = "Sheng Wan academic website research swan0624@uw.edu";
export const tsmFinancialExhibits = (names: string[]) =>
  names.filter((name) =>
    /^[\w.-]*(?:consolidatedreport|consolidatedfina)[\w.-]*\.html?$/i.test(name)
  );
export function assertSecUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !(url.hostname === "sec.gov" || url.hostname.endsWith(".sec.gov"))
  )
    throw new Error("SEC contact User-Agent may only be sent to HTTPS sec.gov endpoints.");
  return url;
}
export type SecFiling = {
  accession: string;
  filedAt: string;
  reportDate: string;
  form: string;
  primaryDocument: string;
  sourceUrl: string;
  directoryUrl: string;
};
export type RecentFilings = {
  accessionNumber: string[];
  filingDate: string[];
  reportDate: string[];
  form: string[];
  primaryDocument: string[];
};
export type Submissions = {
  cik: string;
  name: string;
  tickers?: string[];
  fiscalYearEnd: string;
  filings: {
    recent: RecentFilings;
    files: { name: string; filingFrom: string; filingTo: string }[];
  };
};
export function parseFilings(cik: string, recent: RecentFilings): SecFiling[] {
  const today = new Date().toISOString().slice(0, 10);
  return recent.accessionNumber
    .flatMap((accession, index) => {
      const primaryDocument = recent.primaryDocument[index];
      const filedAt = recent.filingDate[index];
      const reportDate = recent.reportDate[index];
      if (
        !/^\d{10}-\d{2}-\d{6}$/.test(accession) ||
        !/^[\w.-]+$/.test(primaryDocument) ||
        primaryDocument.includes("..") ||
        !/^\d{4}-\d{2}-\d{2}$/.test(reportDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(filedAt) ||
        reportDate > filedAt ||
        filedAt > today
      )
        return [];
      const directoryUrl = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-", "")}/`;
      return [
        {
          accession,
          filedAt,
          reportDate,
          form: recent.form[index],
          primaryDocument,
          directoryUrl,
          sourceUrl: directoryUrl + primaryDocument
        }
      ];
    })
    .sort((a, b) => b.filedAt.localeCompare(a.filedAt));
}

export async function readBounded(response: Response, limit = 24 * 1024 * 1024): Promise<string> {
  if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
  if (Number(response.headers.get("Content-Length")) > limit) {
    await response.body?.cancel();
    throw new Error("Source exceeds safe size limit.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty source response.");
  const decoder = new TextDecoder();
  let total = 0;
  const chunks: string[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) throw new Error("Source exceeds safe size limit.");
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    await reader.cancel();
  }
}
