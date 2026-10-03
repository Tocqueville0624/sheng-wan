import type { CatalogCompany } from "../../src/features/finance/v2-types";
import { parseFilings, type RecentFilings, type SecFiling, type Submissions } from "./sec-shared";

export type SecSource = (url: string, maxAgeMs?: number) => Promise<string>;
export type IssuerSources = {
  submissions: Submissions;
  filings: SecFiling[];
  factsSource: string;
};

/** Discover source identities separately from statement parsing and publication. */
export async function issuerSources(
  identity: CatalogCompany,
  source: SecSource
): Promise<IssuerSources> {
  const submissions = JSON.parse(
    await source(`https://data.sec.gov/submissions/CIK${identity.cik}.json`, 60 * 60 * 1000)
  ) as Submissions;
  if (String(submissions.cik).padStart(10, "0") !== identity.cik)
    throw new Error("SEC issuer identity mismatch.");
  const cutoff = `${new Date().getUTCFullYear() - 11}-01-01`;
  let filings = parseFilings(identity.cik, submissions.filings.recent).filter((f) =>
    /^(10-K|10-Q|20-F|6-K)(\/A)?$/.test(f.form)
  );
  const archives = submissions.filings.files
    .filter((f) => f.filingTo >= cutoff && /^CIK\d+-submissions-\d+\.json$/.test(f.name))
    .sort((a, b) => b.filingTo.localeCompare(a.filingTo))
    .slice(0, 160);
  for (const { name } of archives) {
    const archive = JSON.parse(
      await source(`https://data.sec.gov/submissions/${name}`)
    ) as RecentFilings;
    const all = [
      ...filings,
      ...parseFilings(identity.cik, archive).filter((f) =>
        /^(10-K|10-Q|20-F|6-K)(\/A)?$/.test(f.form)
      )
    ];
    filings = [...new Map(all.map((f) => [f.accession, f])).values()]
      .sort((a, b) => b.filedAt.localeCompare(a.filedAt))
      .slice(0, 700);
  }
  const factsSource = await source(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${identity.cik}.json`
  );
  return { submissions, filings, factsSource };
}
