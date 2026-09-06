import { afterEach, describe, expect, it, vi } from "vitest";
import { FinanceStore, catalog, catalogIdentity } from "../worker/finance-store";
import type { FinanceJob } from "../src/features/finance/v2-types";
import { bundledCompany } from "../worker/finance-store";
import type { CompanyV2 } from "../src/features/finance/v2-types";

// A serialized, persistent storage contract. Parsing tests use separate fixtures;
// queue tests never contact SEC or alter the production snapshots.
class Storage {
  data = new Map<string, unknown>();
  alarm: number | null = null;
  private tail = Promise.resolve();
  async get(key: string | string[]) {
    return structuredClone(
      Array.isArray(key)
        ? new Map(key.filter((k) => this.data.has(k)).map((k) => [k, this.data.get(k)]))
        : this.data.get(key)
    );
  }
  async put(key: string | Record<string, unknown>, value?: unknown) {
    for (const [k, v] of typeof key === "string" ? [[key, value]] : Object.entries(key))
      this.data.set(k as string, structuredClone(v));
  }
  async delete(key: string | string[]) {
    for (const k of Array.isArray(key) ? key : [key]) this.data.delete(k);
  }
  async list({ prefix = "", limit = Infinity } = {}) {
    return structuredClone(
      new Map([...this.data].filter(([k]) => k.startsWith(prefix)).slice(0, limit))
    );
  }
  async setAlarm(value: number) {
    this.alarm = value;
  }
  async deleteAlarm() {
    this.alarm = null;
  }
  async transaction<T>(fn: (tx: Storage) => Promise<T>): Promise<T> {
    const before = this.tail;
    let unlock!: () => void;
    this.tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await before;
    const backup = structuredClone(this.data),
      alarm = this.alarm;
    try {
      return await fn(this);
    } catch (error) {
      this.data = backup;
      this.alarm = alarm;
      throw error;
    } finally {
      unlock();
    }
  }
}
async function create(storage = new Storage()) {
  let ready = Promise.resolve();
  const store = new FinanceStore({
    storage,
    blockConcurrencyWhile: (fn: () => Promise<void>) => {
      ready = fn();
    }
  } as unknown as DurableObjectState);
  await ready;
  return { store, storage };
}
const request = (store: FinanceStore, ticker: string, client = "192.0.2.1") =>
  store.fetch(
    new Request(`https://internal/companies/${ticker}/refresh`, {
      method: "POST",
      headers: { "X-Client-Key": client }
    })
  );
const jobOf = async (response: Response) => ((await response.json()) as { job: FinanceJob }).job;
const read = async (store: FinanceStore, path: string) =>
  (await store.fetch(new Request(`https://internal${path}`))).json();
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("persistent public finance queue", () => {
  it("keeps newly verified business margins visible over a full older stored history without crawling", async () => {
    const { store, storage } = await create();
    const identity = catalogIdentity("MSFT")!;
    const full = structuredClone(bundledCompany(identity)!);
    expect(full.annual.at(-1)!.segments!.some((segment) => segment.grossProfit !== undefined)).toBe(
      true
    );
    const prior = structuredClone(full);
    for (const period of [...prior.annual, ...prior.quarterly]) {
      for (const segment of period.segments ?? []) {
        delete segment.grossProfit;
        delete segment.grossProfitSource;
      }
    }
    await storage.put(`company:${identity.cik}`, prior);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = (await read(store, "/companies/MSFT")) as { company: CompanyV2 };
    expect(result.company.annual).toEqual(full.annual);
    expect(result.company.quarterly).toEqual(full.quarterly);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await storage.get(`company:${identity.cik}`)).toEqual(prior);
  });
  it("keeps a deployed historical backfill visible over an older short stored snapshot without crawling", async () => {
    const { store, storage } = await create();
    const identity = catalogIdentity("MSFT")!;
    const full = structuredClone(bundledCompany(identity)!);
    const short = { ...full, annual: full.annual.slice(-3), quarterly: full.quarterly.slice(-6) };
    await storage.put(`company:${identity.cik}`, short);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = (await read(store, "/companies/MSFT")) as { company: CompanyV2 };
    expect(result.company.annual).toEqual(full.annual);
    expect(result.company.quarterly).toEqual(full.quarterly);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await storage.get(`company:${identity.cik}`)).toEqual(short);
  });
  it("reserves read capacity when the daily background-work budget is exhausted", async () => {
    const { store, storage } = await create();
    const job = await jobOf(await request(store, "AAPL"));
    await storage.put(`quota:work:${Math.floor(Date.now() / 86400000)}`, 4000);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await store.alarm();
    expect(await read(store, `/jobs/${job.id}`)).toMatchObject({
      state: "queued",
      completed: 0,
      retryAt: expect.any(String)
    });
    expect((await request(store, "WMT")).status).toBe(429);
    expect(await read(store, "/companies/AAPL")).toMatchObject({ company: { ticker: "AAPL" } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("coalesces simultaneous and multi-ticker requests by CIK, not ticker or visitor", async () => {
    const { store, storage } = await create();
    const jobs = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        request(store, i % 2 ? "GOOG" : "GOOGL", `192.0.2.${i}`).then(jobOf)
      )
    );
    expect(new Set(jobs.map((j) => j.id)).size).toBe(1);
    expect(storage.data.get("queue")).toEqual([jobs[0].id]);
    expect([...storage.data.keys()].filter((k) => k.startsWith("quota:ip:")).length).toBe(1);
    expect(JSON.stringify([...storage.data])).not.toContain("192.0.2.");
  });
  it("limits each visitor to five new jobs per hour, while repeats and reads remain usable", async () => {
    const { store } = await create();
    for (const ticker of ["AAPL", "MSFT", "NVDA", "AMZN", "META"])
      expect((await request(store, ticker)).status).toBe(202);
    const limited = await request(store, "WMT");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await request(store, "AAPL")).status).toBe(202);
    expect(await read(store, "/companies/AAPL")).toMatchObject({ company: { ticker: "AAPL" } });
  });
  it("stops new imports at twenty daily without consuming the separate update allowance", async () => {
    const { store } = await create();
    const existing = new Set(["AAPL", "MSFT", "GOOG", "GOOGL", "NVDA", "AMZN", "META", "TSM"]);
    const candidates = [
      ...new Map(
        catalog.companies.filter((c) => !existing.has(c.ticker)).map((c) => [c.cik, c])
      ).values()
    ].slice(0, 21);
    for (let i = 0; i < candidates.length; i++)
      expect((await request(store, candidates[i].ticker, `192.0.2.${i}`)).status).toBe(
        i < 20 ? 202 : 429
      );
    expect((await request(store, "AAPL", "192.0.2.100")).status).toBe(202);
  });
  it("enforces the daily update cap without blocking saved data", async () => {
    const { store, storage } = await create();
    await storage.put(`quota:day:${Math.floor(Date.now() / 86400000)}`, {
      imports: 0,
      updates: 100
    });
    expect((await request(store, "AAPL")).status).toBe(429);
    expect((await request(store, "WMT")).status).toBe(202);
    expect(await read(store, "/companies/AAPL")).toMatchObject({ company: { ticker: "AAPL" } });
  });
  it("survives object restart and retains all verified data when SEC returns 403", async () => {
    const { store, storage } = await create();
    const before = (await read(store, "/companies/AAPL")) as { company: unknown };
    const job = await jobOf(await request(store, "AAPL"));
    const resumed = await create(storage);
    const fetcher = vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }));
    vi.stubGlobal("fetch", fetcher);
    await resumed.store.alarm();
    expect(await read(resumed.store, `/jobs/${job.id}`)).toMatchObject({ state: "failed" });
    expect(await read(resumed.store, "/companies/AAPL")).toMatchObject({ company: before.company });
    expect(storage.data.get("queue")).toEqual([]);
    expect(storage.alarm).toBeNull();
    expect(fetcher.mock.calls[0][1].redirect).toBe("manual");
    expect(fetcher.mock.calls[0][1].headers["User-Agent"]).toContain("swan0624@uw.edu");
    expect((await request(resumed.store, "AAPL")).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rotates backfills fairly and does not retry a throttled source before retryAt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00Z"));
    const { store, storage } = await create();
    const first = await jobOf(await request(store, "WMT"));
    const second = await jobOf(await request(store, "JPM"));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(
        Response.json({
          cik: catalogIdentity("JPM")!.cik,
          tickers: ["JPM"],
          filings: { recent: { accessionNumber: [] }, files: [] }
        })
      );
    vi.stubGlobal("fetch", fetcher);
    await store.alarm();
    expect(storage.data.get("queue")).toEqual([second.id, first.id]);
    vi.setSystemTime(Date.now() + 600);
    await store.alarm();
    expect(await read(store, `/jobs/${second.id}`)).toMatchObject({
      state: "fetching",
      completed: 1
    });
    expect(await read(store, `/jobs/${first.id}`)).toMatchObject({
      completed: 0,
      retryAt: "2026-09-04T12:00:30.000Z"
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rolls back a failed publication transaction", async () => {
    const { store, storage } = await create();
    const original = bundledCompany(catalogIdentity("AAPL")!)!;
    const key = `company:${original.cik}`;
    await storage.put(key, original);
    const put = storage.put.bind(storage);
    vi.spyOn(storage, "put").mockImplementation(async (key, value) => {
      if (key === "index") throw new Error("disk full");
      return put(key, value);
    });
    // Exercise the actual merge/validate/publication boundary, injecting a fault
    // after the company row is written but before the index transaction commits.
    const publish = Reflect.get(store, "publish") as (
      task: { job: { ticker: string }; changed: boolean },
      incoming: CompanyV2
    ) => Promise<void>;
    await expect(
      publish.call(store, { job: { ticker: "AAPL" }, changed: false }, structuredClone(original))
    ).rejects.toThrow("disk full");
    expect(await storage.get(key)).toEqual(original);
    expect(await storage.get(`previous:${original.cik}`)).toBeUndefined();
    expect(await storage.get("index")).toBeUndefined();
  });
});
