import { writeFile, rename } from "node:fs/promises";
import { companies } from "./companies";
import { validateFeaturedHistory } from "./history";
import {
  pendingJob,
  type CompanyResponse,
  type FinanceHistory
} from "../../src/features/finance/v2-types";

// Read-only: a capture never queues SEC requests or changes the online database.
const history: FinanceHistory = {
  schemaVersion: 2,
  capturedAt: new Date().toISOString(),
  companies: []
};
for (const identity of companies) {
  const response = await fetch(`https://shengwan.org/api/finance/v2/companies/${identity.ticker}`, {
    signal: AbortSignal.timeout(30000),
    redirect: "error"
  });
  if (!response.ok) throw new Error(`${identity.ticker}: online snapshot HTTP ${response.status}.`);
  const data = (await response.json()) as CompanyResponse;
  if (!data.company || pendingJob(data.job))
    throw new Error(`${identity.ticker}: wait for the historical import to finish before saving.`);
  history.companies.push(data.company);
}
validateFeaturedHistory(history);
const destination = "src/data/generated/finance-history.json";
const temporary = `${destination}.${process.pid}.tmp`;
await writeFile(temporary, JSON.stringify(history, null, 2) + "\n");
await rename(temporary, destination);
console.log(
  `Saved ${history.companies.length} validated companies, each with 10 annual and 20 quarterly periods.`
);
