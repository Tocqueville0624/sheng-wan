import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import type { FinanceManifest } from "../../src/features/finance/types";
import type { FinanceHistory } from "../../src/features/finance/v2-types";
import { filingAdapters } from "./adapters";
import { validateFeaturedHistory } from "./history";
import { enrichSegmentGrossProfits, parseInlineXbrl } from "./ixbrl";
import { fetchSec } from "./sec-client";
import { assertPublishableManifest } from "./validate";

// Add only same-filing business gross profit. Existing statement amounts,
// classification, period coverage and SEC check timestamps remain intact.
const paths = ["src/data/generated/finance-history.json", "src/data/generated/finance.json"];
const snapshots = await Promise.all(
  paths.map(
    async (path) => JSON.parse(await readFile(path, "utf8")) as FinanceHistory | FinanceManifest
  )
);
const parsed = new Map<string, ReturnType<typeof parseInlineXbrl>>();
const assembledAt = new Date().toISOString();
const changed = new Set<number>();
for (const [index, snapshot] of snapshots.entries()) {
  for (const company of snapshot.companies) {
    const adapter = filingAdapters[company.ticker];
    if (!adapter?.segments.some((rule) => rule.grossProfitTags || rule.costOfRevenueTags)) continue;
    const before = JSON.stringify([company.annual, company.quarterly]);
    let covered = 0;
    for (const kind of ["annual", "quarterly"] as const) {
      for (const [periodIndex, period] of company[kind].entries()) {
        if (!period.segments?.length) continue;
        const url = period.segmentSourceUrl!;
        if (!parsed.has(url)) parsed.set(url, parseInlineXbrl(await fetchSec(url)));
        const enriched = enrichSegmentGrossProfits(period, parsed.get(url)!, adapter, url);
        // Both v1 and v2 retain their own unchanged period fields.
        Object.assign(company[kind][periodIndex], enriched);
        covered += enriched.segments!.filter((segment) => segment.grossProfit !== undefined).length;
      }
    }
    const after = JSON.stringify([company.annual, company.quarterly]);
    if (before !== after) {
      company.version = createHash("sha256").update(after).digest("hex").slice(0, 20);
      company.updatedAt = assembledAt;
      changed.add(index);
    }
    console.log(
      `${paths[index]}: ${company.ticker} has ${covered} verified business gross margins.`
    );
  }
  if (snapshot.schemaVersion === 2) {
    if (changed.has(index)) snapshot.capturedAt = assembledAt;
    validateFeaturedHistory(snapshot);
  } else {
    if (changed.has(index)) {
      snapshot.updatedAt = assembledAt;
      snapshot.version = `${assembledAt.slice(0, 10)}-${createHash("sha256").update(JSON.stringify(snapshot.companies)).digest("hex").slice(0, 12)}`;
    }
    assertPublishableManifest(snapshot);
  }
}
// Fetching, enrichment and validation of both snapshots finish before any write.
for (const index of changed) {
  const path = paths[index];
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(snapshots[index], null, 2) + "\n");
  await rename(temporary, path);
}
console.log(`Saved ${changed.size} validated snapshots; no online refresh was queued.`);
