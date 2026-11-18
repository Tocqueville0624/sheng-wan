import { setTimeout as sleep } from "node:timers/promises";
import { companies } from "./companies";
import { companyFilings } from "./sec-client";
import { latestPendingEarnings, type SecFiling } from "./sec-shared";
import {
  pendingJob,
  type CompanyResponse,
  type FinanceJob
} from "../../src/features/finance/v2-types";

const api = "https://shengwan.org/api/finance/v2";
const deadline = Date.now() + 85 * 60_000;
const only = process.argv[2]?.toUpperCase();
const selected = companies.filter(({ ticker }) => !only || ticker === only);
if (!selected.length) throw new Error("Unknown featured company: " + only);

async function request<T>(path: string, method = "GET"): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(api + path, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30_000)
    });
    if (response.ok) return (await response.json()) as T;
    await response.body?.cancel();
    const delay = (Number(response.headers.get("Retry-After")) || 30) * 1000;
    if (response.status === 429 && attempt < 2 && Date.now() + delay < deadline) {
      console.log("Update allowance resets in " + Math.ceil(delay / 1000) + "s.");
      await sleep(delay + 1000);
    } else if (response.status >= 500 && attempt < 2) {
      await sleep(5000 * (attempt + 1));
    } else throw new Error(method + " " + path + " returned HTTP " + response.status);
  }
}

async function sync({ ticker, cik }: (typeof companies)[number]) {
  const filings = await companyFilings(cik);
  const annual = filings.find((f) => f.form === (ticker === "TSM" ? "20-F" : "10-K"));
  const quarterly = filings.find((f) =>
    ticker === "TSM"
      ? f.form === "6-K" && /^tsm-fsx/i.test(f.primaryDocument) && !f.reportDate.endsWith("-12-31")
      : f.form === "10-Q"
  );
  if (!annual || !quarterly)
    throw new Error("Could not identify both current SEC financial statements.");
  const path = "/companies/" + ticker;
  const matches = (body: CompanyResponse, kind: "annual" | "quarterly", filing: SecFiling) =>
    body.company?.cik === cik &&
    body.company[kind].some(
      (p) =>
        p.endDate === filing.reportDate &&
        p.coverage.basics &&
        p.coverage.segments &&
        (p.filedAt > filing.filedAt ||
          (p.filedAt === filing.filedAt && p.accession === filing.accession))
    );
  const release = latestPendingEarnings(filings);
  const current = (body: CompanyResponse) =>
    matches(body, "annual", annual) &&
    matches(body, "quarterly", quarterly) &&
    (body.earningsRelease?.sourceUrl ?? null) === (release?.sourceUrl ?? null);
  const before = await request<CompanyResponse>(path);
  if (!current(before)) {
    if (!before.available) throw new Error("The production update service is unavailable.");
    const enqueue = () => request<{ job: FinanceJob; reused: boolean }>(path + "/refresh", "POST");
    const queued = await enqueue();
    let job = queued.job;
    if (queued.reused && !pendingJob(job)) {
      // A release can arrive during the website's shared one-hour check window.
      const nextCheck = Date.parse(job.createdAt) + 60 * 60_000 + 1000;
      if (nextCheck > Date.now() && nextCheck < deadline) {
        console.log(ticker + ": waiting for the previous check to expire.");
        await sleep(nextCheck - Date.now());
        ({ job } = await enqueue());
      }
    }
    console.log(ticker + ": tracking " + job.id);
    const jobDeadline = Math.min(deadline, Date.now() + 10 * 60_000);
    while (pendingJob(job) && Date.now() < jobDeadline) {
      await sleep(5000);
      job = await request<FinanceJob>("/jobs/" + job.id);
    }
    if (pendingJob(job) || job.state === "failed") throw new Error(job.state + ": " + job.message);
    if (!current(await request<CompanyResponse>(path)))
      throw new Error(
        "Live filings or the pending earnings announcement still differ from the SEC after refresh: " +
          annual.reportDate +
          " / " +
          quarterly.reportDate
      );
  }
  console.log(
    ticker + ": verified live annual " + annual.reportDate + ", quarterly " + quarterly.reportDate
  );
}

const failures: string[] = [];
for (const identity of selected) {
  try {
    await sync(identity);
  } catch (error) {
    const failure =
      identity.ticker + ": " + (error instanceof Error ? error.message : String(error));
    failures.push(failure);
    console.error(failure);
  }
}
if (failures.length) process.exitCode = 1;
