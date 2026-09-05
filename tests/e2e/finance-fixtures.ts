import type { Page } from "@playwright/test";
import bundled from "../../src/data/generated/finance.json" with { type: "json" };
import history from "../../src/data/generated/finance-history.json" with { type: "json" };
import catalog from "../../src/data/generated/finance-catalog.json" with { type: "json" };
import { upgradeCompany } from "../../scripts/finance/v2-model";
import type { CompanyDataset } from "../../src/features/finance/types";
import type { CompanyV2 } from "../../src/features/finance/v2-types";

export const initialCompany = history.companies[0] as CompanyV2;
// Keep the small, fully detailed chart fixtures. Their simulated assembly time
// must be current enough for the page's stale-response protection to accept them.
export const savedCompanies = bundled.companies.map((c) => ({
  ...upgradeCompany(c as CompanyDataset),
  updatedAt: history.companies.find((h) => h.cik === c.cik)!.updatedAt
}));
export async function mockFinance(
  page: Page,
  overrides: Record<string, CompanyV2 | null> = {},
  processingTickers: string[] = []
) {
  await page.route("**/api/finance/v2/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/finance/v2", "");
    if (path === "/catalog")
      return route.fulfill({
        json: {
          ...catalog,
          available: true,
          companies: catalog.companies.map((c) => ({
            ...c,
            status: processingTickers.includes(c.ticker)
              ? "processing"
              : savedCompanies.some((s) => s.cik === c.cik)
                ? "ready"
                : "available"
          }))
        }
      });
    const ticker = path.split("/")[2];
    if (route.request().method() === "POST")
      return route.fulfill({
        status: 503,
        json: { error: { message: "Updates disabled in read-only visual regression fixture." } }
      });
    const original = savedCompanies.find((c) => c.ticker === ticker);
    const company = ticker in overrides ? overrides[ticker] : (original ?? null);
    return route.fulfill({ json: { company, available: true, job: null } });
  });
}
