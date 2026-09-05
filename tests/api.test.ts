import { describe, expect, it } from "vitest";
import { api } from "../worker/index";

const env = {} as never;

describe("finance API", () => {
  it("lists the supported companies with a visible data status", async () => {
    const response = await api(new Request("https://example.test/api/finance/companies"), env);
    const body = (await response.json()) as {
      companies: { ticker: string; dataStatus: string }[];
      dataStatus: string;
    };
    expect(response.status).toBe(200);
    expect(body.companies).toHaveLength(7);
    expect(body.dataStatus).toBe("verified");
    expect(body.companies.every((company) => company.dataStatus === "verified")).toBe(true);
    expect(body.companies.find((company) => company.ticker === "AAPL")?.dataStatus).toBe(
      "verified"
    );
    expect(body.companies.some((company) => company.ticker === "TSLA")).toBe(false);
    expect(response.headers.get("etag")).toMatch(/^"/);
  });

  it("rejects invalid periods with a structured error", async () => {
    const response = await api(
      new Request("https://example.test/api/finance/companies/AAPL?period=monthly"),
      env
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_PERIOD" } });
  });

  it("excludes Tesla even if an old KV snapshot still includes it", async () => {
    const staleEnv = {
      FINANCE_KV: {
        get: async () => ({ version: "old", companies: [{ ticker: "TSLA", dataStatus: "demo" }] })
      }
    } as never;
    const response = await api(
      new Request("https://example.test/api/finance/companies/TSLA"),
      staleEnv
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNSUPPORTED_COMPANY" }
    });
  });

  it("serves sourced and reconciled Apple business revenue", async () => {
    const response = await api(
      new Request("https://example.test/api/finance/companies/AAPL?period=annual"),
      env
    );
    const body = (await response.json()) as {
      dataStatus: string;
      periods: {
        metrics: { revenue: number };
        segments: { revenue: number }[];
        segmentSourceUrl: string;
      }[];
    };
    expect(body.dataStatus).toBe("verified");
    expect(body.periods).toHaveLength(3);
    for (const period of body.periods) {
      expect(period.segments.reduce((sum, segment) => sum + segment.revenue, 0)).toBe(
        period.metrics.revenue
      );
      expect(period.segmentSourceUrl).toMatch(/^https:\/\/www\.sec\.gov\/Archives\//);
    }
  });

  it("returns a complete all-verified snapshot with reusable ETag", async () => {
    const first = await api(new Request("https://example.test/api/finance/snapshot"), env);
    const body = (await first.json()) as {
      companies: { ticker: string; dataStatus: string; annual: unknown[]; quarterly: unknown[] }[];
      dataStatus: string;
    };
    expect(body.dataStatus).toBe("verified");
    expect(body.companies).toHaveLength(7);
    for (const company of body.companies) {
      expect(company.dataStatus).toBe("verified");
      expect(company.annual.length).toBeGreaterThan(0);
      expect(company.quarterly.length).toBeGreaterThan(0);
    }
    const second = await api(
      new Request("https://example.test/api/finance/snapshot", {
        headers: { "If-None-Match": first.headers.get("etag")! }
      }),
      env
    );
    expect(second.status).toBe(304);
  });

  it("never exposes a legacy synthetic KV snapshot", async () => {
    const staleEnv = {
      FINANCE_KV: {
        get: async () => ({
          schemaVersion: 1,
          version: "demo-old",
          dataStatus: "demo",
          companies: []
        })
      }
    } as never;
    const response = await api(new Request("https://example.test/api/finance/snapshot"), staleEnv);
    const body = (await response.json()) as { dataStatus: string; version: string };
    expect(body.dataStatus).toBe("verified");
    expect(body.version).not.toBe("demo-old");
  });
});
