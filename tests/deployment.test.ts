import { describe, expect, it } from "vitest";
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
