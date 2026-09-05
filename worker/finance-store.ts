import catalogData from "../src/data/generated/finance-catalog.json";
import bundledData from "../src/data/generated/finance.json";
import { companies } from "../scripts/finance/companies";
import { filingAdapters } from "../scripts/finance/adapters";
import { extractInlinePeriods, parseInlineXbrl } from "../scripts/finance/ixbrl";
import { extractTsmHtml } from "../scripts/finance/tsm-html";
import { averageRate, parseH10TaiwanDollar, type FxObservation } from "../scripts/finance/fed";
import { convertPeriodToUsd } from "../scripts/finance/extract";
import {
  extractFactsV2,
  parseFactsDocument,
  convertBasicTwd,
  type FactsDocument
} from "../scripts/finance/facts-v2";
import { mergeV2, upgradeCompany, upgradePeriod, validateV2 } from "../scripts/finance/v2-model";
import {
  SEC_USER_AGENT,
  assertSecUrl,
  parseFilings,
  readBounded,
  tsmFinancialExhibits,
  type RecentFilings,
  type SecFiling,
  type Submissions
} from "../scripts/finance/sec-shared";
import {
  pendingJob,
  type CatalogCompany,
  type CompanyResponse,
  type CompanyV2,
  type FinanceCatalog,
  type FinanceJob
} from "../src/features/finance/v2-types";
import type { FinanceManifest, FinancialPeriod } from "../src/features/finance/types";

export const catalog = catalogData as FinanceCatalog;
const bundled = bundledData as FinanceManifest;
const DAY = 86400000,
  HOUR = 3600000;
const ENGINE_VERSION = "finance-v2.7";
const MAX_DAILY_STEPS = 4000;
const FED = "https://www.federalreserve.gov/releases/h10/hist/dat00_ta.htm";
const json = (value: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });
export const catalogIdentity = (ticker: string) =>
  catalog.companies.find((c) => c.ticker === ticker.toUpperCase().replace("-", "."));
export const bundledCompany = (identity: CatalogCompany) => {
  const original = bundled.companies.find((c) => c.cik === identity.cik);
  return original ? { ...upgradeCompany(original), ticker: identity.ticker } : undefined;
};
type Task = {
  engineVersion?: string;
  job: FinanceJob;
  stage: "submissions" | "archives" | "facts" | "filings";
  archives: string[];
  filings: SecFiling[];
  todo: SecFiling[];
  cursor: number;
  warnings: string[];
  attempts: number;
  changed: boolean;
  fx?: FxObservation[];
  exhibit?: string;
};
type IndexEntry = { cik: string; ticker: string; updatedAt: string };

/** Single SQLite-backed coordinator keeps request spacing and deduplication global. */
export class FinanceStore {
  private salt = "";
  constructor(private ctx: DurableObjectState) {
    ctx.blockConcurrencyWhile(async () => {
      this.salt = (await ctx.storage.get<string>("client-salt")) ?? crypto.randomUUID();
      await ctx.storage.put("client-salt", this.salt);
    });
  }
  private async company(identity: CatalogCompany): Promise<CompanyV2 | undefined> {
    const saved = await this.ctx.storage.get<CompanyV2>(`company:${identity.cik}`);
    return saved ? { ...saved, ticker: identity.ticker } : bundledCompany(identity);
  }
  private async active(cik: string) {
    const id = await this.ctx.storage.get<string>(`active:${cik}`);
    return id ? await this.ctx.storage.get<Task>(`task:${id}`) : undefined;
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/catalog") {
      const index = (await this.ctx.storage.get<Record<string, IndexEntry>>("index")) ?? {};
      const queue = (await this.ctx.storage.get<string[]>("queue")) ?? [];
      const active = await this.ctx.storage.get<Task>(queue.map((id) => `task:${id}`));
      return json({
        ...catalog,
        available: true,
        companies: catalog.companies.map((c) => ({
          ...c,
          status: [...active.values()].some((t) => t.job.cik === c.cik && pendingJob(t.job))
            ? "processing"
            : index[c.cik] || bundledCompany(c)
              ? "ready"
              : "available"
        }))
      });
    }
    const jobMatch = url.pathname.match(/^\/jobs\/([a-f0-9-]{36})$/);
    if (jobMatch) {
      const task = await this.ctx.storage.get<Task>(`task:${jobMatch[1]}`);
      return task
        ? json(task.job)
        : json(
            { error: { message: "This job has expired. Check the company for its saved data." } },
            404
          );
    }
    const match = url.pathname.match(/^\/companies\/([A-Z0-9.-]+)(\/refresh)?$/i);
    const identity = match ? catalogIdentity(match[1]) : undefined;
    if (!identity)
      return json({ error: { message: "Choose a company in the published catalog." } }, 404);
    if (!match![2] && request.method === "GET") {
      const company = await this.company(identity);
      const task = await this.active(identity.cik);
      return json({
        company: company ?? null,
        job: task?.job ?? null,
        available: true
      } satisfies CompanyResponse);
    }
    if (match![2] && request.method === "POST")
      return this.enqueue(identity, request.headers.get("X-Client-Key") ?? "local");
    return json({ error: { message: "Method not supported." } }, 405);
  }
  private async enqueue(identity: CatalogCompany, client: string) {
    const now = Date.now();
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`${this.salt}:${Math.floor(now / DAY)}:${client}`)
      )
    );
    client = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
    // Durable storage transactions serialize concurrent visitors for the same CIK.
    const result = await this.ctx.storage.transaction(async (tx) => {
      const activeId = await tx.get<string>(`active:${identity.cik}`);
      const active = activeId ? await tx.get<Task>(`task:${activeId}`) : undefined;
      if (
        active &&
        (pendingJob(active.job) ||
          (active.engineVersion === ENGINE_VERSION &&
            now - Date.parse(active.job.createdAt) < HOUR))
      )
        return { job: active.job, reused: true };
      const hourKey = `quota:ip:${Math.floor(now / HOUR)}:${client}`;
      const hourCount = (await tx.get<number>(hourKey)) ?? 0;
      const dayKey = `quota:day:${Math.floor(now / DAY)}`;
      const counts = (await tx.get<{ imports: number; updates: number }>(dayKey)) ?? {
        imports: 0,
        updates: 0
      };
      const existing =
        (await tx.get<CompanyV2>(`company:${identity.cik}`)) ?? bundledCompany(identity);
      const kind = existing ? "updates" : "imports";
      const work = (await tx.get<number>(`quota:work:${Math.floor(now / DAY)}`)) ?? 0;
      if (hourCount >= 5 || counts[kind] >= (existing ? 100 : 20) || work >= MAX_DAILY_STEPS)
        return {
          retryAt: new Date(
            (Math.floor(now / (hourCount >= 5 ? HOUR : DAY)) + 1) * (hourCount >= 5 ? HOUR : DAY)
          ).toISOString()
        };
      const job: FinanceJob = {
        id: crypto.randomUUID(),
        ticker: identity.ticker,
        cik: identity.cik,
        state: "queued",
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        message: "Queued for an SEC filing check. Saved data remains available.",
        completed: 0,
        total: 1
      };
      const task: Task = {
        engineVersion: ENGINE_VERSION,
        job,
        stage: "submissions",
        archives: [],
        filings: [],
        todo: [],
        cursor: 0,
        warnings: [],
        attempts: 0,
        changed: false
      };
      const queue = (await tx.get<string[]>("queue")) ?? [];
      await tx.put({
        [`task:${job.id}`]: task,
        [`active:${identity.cik}`]: job.id,
        [hourKey]: hourCount + 1,
        [dayKey]: { ...counts, [kind]: counts[kind] + 1 },
        queue: [...queue, job.id]
      });
      await tx.setAlarm(now + 100);
      return { job, reused: false };
    });
    if ("retryAt" in result)
      return json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "The free update allowance has been reached. Saved data is still available."
          },
          retryAt: result.retryAt
        },
        429,
        {
          "Retry-After": String(Math.max(1, Math.ceil((Date.parse(result.retryAt!) - now) / 1000)))
        }
      );
    return json(result, pendingJob(result.job) ? 202 : 200);
  }
  private async fetchSource(url: string) {
    const isFed = url === FED;
    if (!isFed) assertSecUrl(url);
    const last = (await this.ctx.storage.get<number>("last-request")) ?? 0;
    const wait = Math.max(0, 550 - (Date.now() - last));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    await this.ctx.storage.put("last-request", Date.now());
    const response = await fetch(url, {
      headers: {
        "User-Agent": isFed ? "ShengWanAcademicWebsite/1.0" : SEC_USER_AGENT,
        Accept: "application/json,text/html"
      },
      redirect: "manual",
      signal: AbortSignal.timeout(25000)
    });
    return readBounded(response);
  }
  private async publish(task: Task, incoming: CompanyV2) {
    const identity = catalogIdentity(task.job.ticker)!;
    const old = await this.company(identity);
    const next = mergeV2(old, incoming);
    next.checkedAt = new Date().toISOString();
    const contents = JSON.stringify([next.annual, next.quarterly]);
    if (old && JSON.stringify([old.annual, old.quarterly]) === contents) {
      next.version = old.version;
      next.updatedAt = old.updatedAt;
    } else {
      const hash = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(contents))
      );
      next.version = [...hash]
        .slice(0, 10)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      next.updatedAt = next.checkedAt;
      task.changed = true;
    }
    validateV2(next);
    if (JSON.stringify(next).length > 1500000)
      throw new Error("Normalized company data exceeds safe storage bounds.");
    await this.ctx.storage.transaction(async (tx) => {
      const index = (await tx.get<Record<string, IndexEntry>>("index")) ?? {};
      if (old) await tx.put(`previous:${identity.cik}`, old);
      await tx.put(`company:${identity.cik}`, next);
      index[identity.cik] = {
        cik: identity.cik,
        ticker: identity.ticker,
        updatedAt: next.updatedAt
      };
      await tx.put("index", index);
    });
  }
  private async step(task: Task) {
    const identity = catalogIdentity(task.job.ticker)!;
    const config = companies.find((c) => c.cik === identity.cik);
    const mappedTicker = config?.ticker;
    if (task.stage === "submissions") {
      task.job.state = "fetching";
      task.job.message = "Checking SEC issuer identity and current filings…";
      const submissions = JSON.parse(
        await this.fetchSource(`https://data.sec.gov/submissions/CIK${identity.cik}.json`)
      ) as Submissions;
      if (String(submissions.cik).padStart(10, "0") !== identity.cik)
        throw new Error("SEC issuer identity mismatch.");
      if (!submissions.tickers?.some((t) => t.toUpperCase().replace("-", ".") === identity.ticker))
        throw new Error(
          "The SEC ticker/CIK mapping no longer matches this dated catalog entry. A catalog review is required."
        );
      const cutoff = `${new Date().getUTCFullYear() - 11}-01-01`;
      task.filings = parseFilings(identity.cik, submissions.filings.recent).filter((f) =>
        /^(10-K|10-Q|20-F|6-K)(\/A)?$/.test(f.form)
      );
      task.archives = submissions.filings.files
        .filter((f) => f.filingTo >= cutoff && /^CIK\d+-submissions-\d+\.json$/.test(f.name))
        .sort((a, b) => b.filingTo.localeCompare(a.filingTo))
        .map((f) => f.name)
        .slice(0, 160);
      // Publish recent data before a filing-heavy bank's older indexes finish.
      task.stage = "facts";
      task.job.total = 3 + task.archives.length;
    } else if (task.stage === "archives") {
      task.job.state = "backfilling";
      task.job.message = `Indexing older SEC filings; ${task.archives.length} source indexes remain. Recent validated data is already available when supported.`;
      const name = task.archives.shift()!;
      const archive = JSON.parse(
        await this.fetchSource(`https://data.sec.gov/submissions/${name}`)
      ) as RecentFilings;
      const all = [
        ...task.filings,
        ...parseFilings(identity.cik, archive).filter((f) =>
          /^(10-K|10-Q|20-F|6-K)(\/A)?$/.test(f.form)
        )
      ];
      task.filings = [...new Map(all.map((f) => [f.accession, f])).values()]
        .sort((a, b) => b.filedAt.localeCompare(a.filedAt))
        .slice(0, 700);
      if (!task.archives.length) task.stage = "facts";
    } else if (task.stage === "facts") {
      task.job.state = "validating";
      task.job.message = "Validating source-linked historical financial metrics…";
      if (mappedTicker === "TSM" && !task.fx) {
        task.fx = parseH10TaiwanDollar(await this.fetchSource(FED));
        if (!task.fx.length) throw new Error("No validated Federal Reserve FX observations.");
        task.job.total++;
        return;
      }
      {
        try {
          const factsKey = `facts:${task.job.id}`;
          const facts =
            (await this.ctx.storage.get<FactsDocument>(factsKey)) ??
            parseFactsDocument(
              await this.fetchSource(
                `https://data.sec.gov/api/xbrl/companyfacts/CIK${identity.cik}.json`
              )
            );
          if (task.archives.length && JSON.stringify(facts).length < 1500000)
            await this.ctx.storage.put(factsKey, facts);
          const basic = extractFactsV2(
            facts,
            identity,
            task.filings,
            mappedTicker === "TSM" ? "TWD" : undefined
          );
          if (mappedTicker === "TSM") {
            basic.annual = basic.annual.map((p) =>
              convertBasicTwd(p, averageRate(task.fx!, p.startDate, p.endDate), FED)
            );
            basic.quarterly = basic.quarterly.map((p) =>
              convertBasicTwd(p, averageRate(task.fx!, p.startDate, p.endDate), FED)
            );
          }
          await this.publish(task, basic);
        } catch (error) {
          if (!config && !task.archives.length) throw error;
          task.warnings.push(
            `Basic history: ${error instanceof Error ? error.message : "source unavailable"}`
          );
        }
      }
      if (task.archives.length) {
        task.stage = "archives";
        return;
      }
      if (config) {
        const annual = task.filings
          .filter((f) => f.form === (mappedTicker === "TSM" ? "20-F" : "10-K"))
          .slice(0, 10);
        const quarterly = task.filings
          .filter((f) =>
            mappedTicker === "TSM"
              ? f.form === "6-K" &&
                /^tsm-fsx/i.test(f.primaryDocument) &&
                !f.reportDate.endsWith("-12-31")
              : f.form === "10-Q"
          )
          .slice(0, 20);
        // New statements first; older unsupported taxonomy never blocks recent data.
        task.todo = [...annual, ...quarterly].sort((a, b) =>
          b.reportDate.localeCompare(a.reportDate)
        );
        task.job.total += task.todo.length;
      }
      task.stage = "filings";
    } else if (task.cursor < task.todo.length && config) {
      task.job.state = "backfilling";
      const filing = task.todo[task.cursor];
      task.job.message = `Reading reviewed business categories: ${filing.reportDate} (${task.cursor + 1}/${task.todo.length}).`;
      const cacheKey = `filing:v3:${identity.cik}:${filing.accession}`;
      try {
        let periods = await this.ctx.storage.get<FinancialPeriod[]>(cacheKey);
        if (!periods) {
          if (mappedTicker === "TSM" && filing.form === "6-K" && !task.exhibit) {
            const index = JSON.parse(
              await this.fetchSource(`${filing.directoryUrl}index.json`)
            ) as { directory: { item: { name: string }[] } };
            const exhibits = tsmFinancialExhibits(index.directory.item.map((i) => i.name));
            if (exhibits.length !== 1) throw new Error("No unique consolidated report exhibit.");
            task.exhibit = filing.directoryUrl + exhibits[0];
            task.job.total++;
            return;
          }
          const html = await this.fetchSource(task.exhibit ?? filing.sourceUrl);
          periods =
            mappedTicker === "TSM" && filing.form === "6-K"
              ? extractTsmHtml(html, task.exhibit!, filing.filedAt)
              : extractInlinePeriods(
                  parseInlineXbrl(html),
                  config,
                  filingAdapters[config.ticker],
                  filing.sourceUrl,
                  filing.filedAt
                );
          if (!periods.some((p) => p.endDate === filing.reportDate))
            throw new Error("Current report period lacks a reviewed breakdown.");
          periods = periods.map((p) => ({ ...p, accession: filing.accession }));
          if (mappedTicker === "TSM")
            periods = periods.map((p) =>
              convertPeriodToUsd(p, averageRate(task.fx!, p.startDate, p.endDate), FED)
            );
          if (JSON.stringify(periods).length < 1000000)
            await this.ctx.storage.put(cacheKey, periods);
        }
        const base = await this.company(identity);
        if (!base) throw new Error("No validated company baseline.");
        await this.publish(task, {
          ...base,
          warnings: [],
          annual: periods.filter((p) => p.kind === "annual").map(upgradePeriod),
          quarterly: periods.filter((p) => p.kind === "quarterly").map(upgradePeriod)
        });
      } catch (error) {
        task.warnings.push(
          `${filing.reportDate}: ${error instanceof Error ? error.message : "Unsupported source"}`
        );
      }
      task.cursor++;
      task.exhibit = undefined;
    }
  }
  async alarm() {
    const queue = (await this.ctx.storage.get<string[]>("queue")) ?? [];
    if (!queue.length) return;
    const tasks = await this.ctx.storage.get<Task>(queue.map((id) => `task:${id}`));
    // A backfill or delayed retry must not starve another company's recent data.
    const id = queue.find(
      (id) => !(Date.parse(tasks.get(`task:${id}`)?.job.retryAt ?? "") > Date.now())
    );
    if (!id) {
      await this.ctx.storage.setAlarm(
        Math.min(...[...tasks.values()].map((t) => Date.parse(t.job.retryAt!)))
      );
      return;
    }
    const task = tasks.get(`task:${id}`);
    if (!task) {
      await this.ctx.storage.put(
        "queue",
        queue.filter((entry) => entry !== id)
      );
      await this.ctx.storage.setAlarm(Date.now() + 600);
      return;
    }
    try {
      const workKey = `quota:work:${Math.floor(Date.now() / DAY)}`;
      const work = (await this.ctx.storage.get<number>(workKey)) ?? 0;
      if (work >= MAX_DAILY_STEPS) {
        task.job.retryAt = new Date((Math.floor(Date.now() / DAY) + 1) * DAY).toISOString();
        task.job.message =
          "The daily free processing budget is paused. Saved data remains readable; this task resumes after " +
          task.job.retryAt;
      } else {
        await this.ctx.storage.put(workKey, work + 1);
        await this.step(task);
        task.attempts = 0;
        task.job.retryAt = undefined;
        task.job.completed++;
        if (task.stage === "filings" && task.cursor >= task.todo.length) {
          const company = await this.company(catalogIdentity(task.job.ticker)!);
          if (!company) throw new Error("No supported financial statements were available.");
          const limited =
            task.warnings.length > 0 ||
            company.annual.length < 10 ||
            company.quarterly.length < 20 ||
            [...company.annual, ...company.quarterly].some((p) => !p.coverage.segments);
          task.job.state = limited ? "partial" : task.changed ? "ready" : "unchanged";
          task.job.total = task.job.completed;
          task.job.message = `${task.changed ? "Validated data saved." : "SEC check finished; saved statement values are unchanged."} ${company.annual.length} annual and ${company.quarterly.length} quarterly periods available.${limited ? " Some history or business-category detail is unavailable; no missing figures were estimated." : ""}`;
          company.checkedAt = new Date().toISOString();
          company.warnings = [...new Set([...company.warnings, ...task.warnings])].slice(0, 40);
          await this.ctx.storage.put(`company:${task.job.cik}`, company);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "SEC data is currently unavailable.";
      if (/HTTP (429|5\d\d)|timeout/i.test(message) && task.attempts < 2) {
        task.attempts++;
        task.job.message = "Source temporarily unavailable; retrying without replacing saved data.";
        task.job.retryAt = new Date(Date.now() + task.attempts * 30000).toISOString();
      } else {
        task.job.state = "failed";
        task.job.message = `${message} Previously validated data has been retained.`;
      }
    }
    task.job.updatedAt = new Date().toISOString();
    if (!pendingJob(task.job)) {
      await this.ctx.storage.delete(`facts:${task.job.id}`);
      task.filings = [];
      task.todo = [];
      task.archives = [];
      task.fx = undefined;
      task.warnings = task.warnings.slice(0, 40);
    }
    await this.ctx.storage.transaction(async (tx) => {
      await tx.put(`task:${id}`, task);
      // Enqueues can happen during fetch: re-read rather than overwriting their work.
      const latestQueue = (await tx.get<string[]>("queue")) ?? [];
      const remaining = latestQueue.filter((entry) => entry !== id);
      if (pendingJob(task.job)) remaining.push(id);
      await tx.put("queue", remaining);
      if (remaining.length) await tx.setAlarm(Date.now() + 600);
      else await tx.deleteAlarm();
    });
    if (!pendingJob(task.job)) await this.cleanup();
  }
  private async cleanup() {
    const now = Date.now();
    if (now - ((await this.ctx.storage.get<number>("last-cleanup")) ?? 0) < DAY) return;
    const tasks = await this.ctx.storage.list<Task>({ prefix: "task:", limit: 1000 });
    const stale = [...tasks]
      .filter(([, t]) => !pendingJob(t.job) && Date.parse(t.job.updatedAt) < now - 7 * DAY)
      .map(([key]) => key);
    const quotas = await this.ctx.storage.list({ prefix: "quota:", limit: 2000 });
    for (const key of quotas.keys()) {
      const parts = key.split(":");
      const epoch = Number(parts[2]);
      if (
        parts[1] === "ip" ? epoch < Math.floor(now / HOUR) - 1 : epoch < Math.floor(now / DAY) - 1
      )
        stale.push(key);
    }
    for (let i = 0; i < stale.length; i += 100)
      await this.ctx.storage.delete(stale.slice(i, i + 100));
    await this.ctx.storage.put("last-cleanup", now);
  }
}
