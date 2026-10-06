import manifest from "../src/data/generated/finance-reviewed-snapshots.json";
import { mergeV2, validateV2 } from "../scripts/finance/v2-model";
import { readBounded } from "../scripts/finance/sec-shared";
import type { CatalogCompany, CompanyV2 } from "../src/features/finance/v2-types";

export const reviewedSnapshotIndex = manifest;
type Snapshot = { company: CompanyV2; sha256: string; checkedAt: string };
// A small cache per asset binding avoids rechecking an immutable dataset on
// every progress poll, without accumulating the entire company catalog in RAM.
const validated = new WeakMap<Pick<Fetcher, "fetch">, Map<string, CompanyV2>>();

/** Only deployment-owned, hash-pinned assets; no caller-supplied URL or SEC request. */
export async function reviewedSnapshot(
  identity: CatalogCompany,
  assets: Pick<Fetcher, "fetch">
): Promise<Snapshot | undefined> {
  const entry = manifest.find((candidate) => candidate.cik === identity.cik);
  if (!entry) return;
  try {
    const cached = validated.get(assets)?.get(entry.sha256);
    if (cached)
      return {
        company: { ...cached, ticker: identity.ticker },
        sha256: entry.sha256,
        checkedAt: entry.checkedAt
      };
    const response = await assets.fetch(
      new Request(`https://finance.internal/data/finance/reviewed/${entry.cik}.json`)
    );
    if (!response.headers.get("Content-Type")?.includes("application/json")) return;
    const body = await readBounded(response, 1024 * 1024);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))
    );
    const sha256 = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (sha256 !== entry.sha256) return;
    const company = JSON.parse(body) as CompanyV2;
    if (company.cik !== identity.cik || company.checkedAt !== entry.checkedAt) return;
    validateV2(company);
    const cache = validated.get(assets) ?? new Map<string, CompanyV2>();
    if (cache.size >= 3) cache.delete(cache.keys().next().value!);
    cache.set(sha256, company);
    validated.set(assets, cache);
    return { company: { ...company, ticker: identity.ticker }, sha256, checkedAt: entry.checkedAt };
  } catch {
    // Unavailable or corrupt assets cannot replace stored source-validated data.
  }
}

export async function supplementReviewedHistory(saved: CompanyV2 | null, snapshot: Snapshot) {
  const company = saved ? mergeV2(snapshot.company, saved) : structuredClone(snapshot.company);
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify([company.annual, company.quarterly]))
    )
  );
  company.version = [...digest]
    .slice(0, 10)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  company.updatedAt = [snapshot.company.updatedAt, saved?.updatedAt ?? ""].sort().at(-1)!;
  company.checkedAt = [snapshot.checkedAt, saved?.checkedAt ?? ""].sort().at(-1)!;
  return {
    company,
    savedSourceSnapshot: { sha256: snapshot.sha256, checkedAt: snapshot.checkedAt }
  };
}
