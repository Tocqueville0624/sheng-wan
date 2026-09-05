import { describe, expect, it, vi } from "vitest";
import worker from "../worker/index";

describe("production host redirects", () => {
  it("preserves the API path, query and HTTP method through a permanent redirect", async () => {
    const response = await worker.fetch(
      new Request("https://www.shengwan.org/api/finance/v2/companies/AAPL/refresh?check=1", {
        method: "POST"
      }),
      {
        CANONICAL_ORIGIN: "https://shengwan.org"
      } as never
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://shengwan.org/api/finance/v2/companies/AAPL/refresh?check=1"
    );
  });

  it("does not redirect a preview host to production", async () => {
    const response = await worker.fetch(
      new Request("https://preview.example.test/api/finance/companies"),
      {} as never
    );
    expect(response.status).toBe(200);
    expect(response.headers.has("location")).toBe(false);
  });
});

describe("staging access", () => {
  it.each(["/", "/media/home/image.jpg", "/api/finance/companies"])(
    "blocks unauthenticated requests to %s before serving any content",
    async (path) => {
      const assets = { fetch: vi.fn() };
      for (const token of [undefined, "test-token"]) {
        const response = await worker.fetch(new Request(`https://staging.example.test${path}`), {
          ASSETS: assets,
          STAGING_ACCESS_REQUIRED: "true",
          STAGING_ACCESS_TOKEN: token
        } as never);
        expect(response.status).toBe(token ? 401 : 503);
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
      expect(assets.fetch).not.toHaveBeenCalled();
    }
  );

  it("rejects a wrong token and serves content only with the configured bearer token", async () => {
    const assets = { fetch: vi.fn(() => new Response("private staging")) };
    const env = {
      ASSETS: assets,
      STAGING_ACCESS_REQUIRED: "true",
      STAGING_ACCESS_TOKEN: "test-token"
    };
    for (const [authorization, status] of [
      ["Bearer wrong", 401],
      ["Bearer test-token", 200]
    ] as const) {
      const response = await worker.fetch(
        new Request("https://staging.example.test/", {
          headers: { Authorization: authorization }
        }),
        env as never
      );
      expect(response.status).toBe(status);
    }
    expect(assets.fetch).toHaveBeenCalledTimes(1);
  });
});
