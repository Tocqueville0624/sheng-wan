import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { mockFinance, savedCompanies } from "./finance-fixtures";
import { amount } from "../../src/features/finance/BasicHistory";
import type { CompanyV2 } from "../../src/features/finance/v2-types";

const apple = savedCompanies.find((c) => c.ticker === "AAPL")!;
function updated() {
  const company = structuredClone(apple);
  company.updatedAt = new Date(Date.parse(company.updatedAt) + 60000).toISOString();
  company.checkedAt = new Date().toISOString();
  company.version = "source-validated-refresh-regression";
  return company;
}

test("a newer validated company updates without requiring the whole company universe", async ({
  page
}) => {
  const next = updated();
  await mockFinance(page, { AAPL: next });
  await page.goto("/playground/thales-olive/");
  await expect(page.locator(".finance-source")).toContainText(next.version);
  await expect(page.locator(".table-panel tbody tr")).toHaveCount(next.annual.length);
  await expect(page.locator(".finance-update")).toContainText("Last SEC check:");
  await expect(page.getByRole("button", { name: "Check latest SEC filings" })).toBeEnabled();
});

const rejected: { name: string; change: (c: CompanyV2) => void }[] = [
  {
    name: "unverified data",
    change: (c) => {
      c.dataStatus = "demo";
    }
  },
  {
    name: "unreconciled categories",
    change: (c) => {
      c.annual[0].segments![0].revenue += 1000000;
    }
  },
  {
    name: "missing metric provenance",
    change: (c) => {
      delete c.annual[0].metricSources.revenue;
    }
  },
  {
    name: "wrong issuer identity",
    change: (c) => {
      c.cik = "0000019617";
    }
  },
  {
    name: "older server state",
    change: (c) => {
      c.updatedAt = new Date(Date.parse(apple.updatedAt) - 60000).toISOString();
    }
  }
];
for (const { name, change } of rejected)
  test(name + " retains the newer verified fallback", async ({ page }) => {
    const next = updated();
    change(next);
    await mockFinance(page, { AAPL: next });
    await page.goto("/playground/thales-olive/");
    await expect(page.getByRole("button", { name: "Retry connection" })).toBeVisible();
    await expect(page.locator(".finance-source")).toContainText(apple.version);
    await expect(page.locator(".finance-source")).not.toContainText(next.version);
    await expect(page.locator(".history-chart")).toContainText("iPhone");
  });

test("a source failure preserves charts and offers a connection retry", async ({ page }) => {
  await mockFinance(page);
  await page.route("**/api/finance/v2/companies/AAPL", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "SEC temporarily unavailable. Saved data remains visible." } }
    })
  );
  await page.goto("/playground/thales-olive/");
  await expect(page.locator(".finance-update")).toContainText("SEC temporarily unavailable");
  await expect(page.locator(".history-chart")).toBeVisible();
  await expect(page.locator(".finance-source")).toContainText(apple.version);
});

test("company, frequency, period, KPIs, chart and history URL stay in sync", async ({
  page
}, testInfo) => {
  await mockFinance(page);
  const period = apple.quarterly[0];
  await page.goto("/playground/thales-olive/?ticker=AAPL&period=quarterly&statement=" + period.id);
  const select = page.getByRole("combobox", { name: "Period", exact: true });
  await expect(select).toHaveValue(period.id);
  await expect(page.locator(".company-summary")).toContainText(period.label);
  await expect(page.locator(".kpi-grid")).toContainText(amount(period.metrics.revenue));
  await expect(page.locator(".flow-chart")).toContainText(period.label);
  await expect(page.locator("tr[aria-current=true]")).toContainText(period.label);
  const latest = apple.quarterly.at(-1)!;
  await select.selectOption(latest.id);
  await expect(page).toHaveURL(new RegExp("statement=" + latest.id));
  await expect(page.locator(".kpi-grid")).toContainText(amount(latest.metrics.revenue));
  await page.goBack();
  await expect(select).toHaveValue(period.id);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const csv = await download,
    path = testInfo.outputPath("selected-history.csv");
  await csv.saveAs(path);
  const source = await readFile(path, "utf8");
  expect(csv.suggestedFilename()).toBe("aapl-quarterly-history.csv");
  expect(source).toContain("metric_provenance");
  for (const p of apple.quarterly) expect(source).toContain(p.sourceUrl);
});

test("catalog search does not crawl; empty and basic-only coverage are honest", async ({
  page
}) => {
  const basic = updated();
  for (const p of [...basic.annual, ...basic.quarterly]) {
    delete p.segments;
    p.coverage.segments = false;
    p.coverage.sankey = false;
  }
  await mockFinance(page, { AAPL: basic });
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() === "POST") writes++;
  });
  await page.goto("/playground/thales-olive/");
  await expect(page.locator(".finance-source")).toContainText(basic.version);
  await expect(
    page.getByRole("heading", { name: "Revenue and net income", exact: true })
  ).toHaveCount(0);
  await expect(page.locator(".history-chart")).toHaveCount(0);
  await expect(page.locator(".kpi-grid")).toContainText(
    amount(basic.annual.at(-1)!.metrics.revenue)
  );
  await expect(page.locator(".table-panel tbody tr")).toHaveCount(basic.annual.length);
  await expect(page.locator(".flow-chart")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search companies" }).fill("Berkshire");
  await page.locator('[data-ticker="BRK.B"]').click();
  await expect(page.getByRole("button", { name: "Get SEC data" })).toBeEnabled();
  await expect(page.locator(".history-chart")).toHaveCount(0);
  await page.getByRole("searchbox").fill("NotAnIssuer12345");
  await expect(page.getByText("No matching company.")).toBeVisible();
  expect(writes).toBe(0);
});

test("an import resumes after reload and reveals validated data when the shared job finishes", async ({
  page
}) => {
  // The catalog snapshot can still say processing after the polled job completes.
  await mockFinance(page, {}, ["GOOG"]);
  let started = false,
    done = false,
    posts = 0;
  const company = structuredClone(savedCompanies.find((c) => c.ticker === "GOOGL")!);
  company.ticker = "GOOG";
  const id = "00000000-0000-4000-8000-000000000001";
  const job = () => ({
    id,
    ticker: "GOOG",
    cik: company.cik,
    state: done ? "partial" : "fetching",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completed: done ? 2 : 1,
    total: 2,
    message: done ? "Validated data saved." : "Fetching SEC sources."
  });
  await page.route("**/api/finance/v2/companies/GOOG**", (route) => {
    if (route.request().method() === "POST") {
      started = true;
      posts++;
      return route.fulfill({ status: 202, json: { job: job(), reused: false } });
    }
    return route.fulfill({
      json: { company: done ? company : null, job: started ? job() : null, available: true }
    });
  });
  await page.route("**/api/finance/v2/jobs/" + id, (route) => route.fulfill({ json: job() }));
  await page.goto("/playground/thales-olive/?ticker=GOOG");
  await page.getByRole("button", { name: "Get SEC data" }).click();
  await expect(page.getByRole("button", { name: "SEC task in progress" })).toBeDisabled();
  await page.reload();
  await expect(page.locator(".finance-update")).toContainText("Fetching SEC sources.");
  await expect(page.locator('[data-ticker="GOOG"]')).toContainText("Processing");
  done = true;
  await expect(page.locator(".history-chart")).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".finance-update")).toContainText("Validated data saved.");
  await expect(page.locator('[data-ticker="GOOG"]')).toContainText("Saved data");
  await expect(page.locator('[data-ticker="GOOG"]')).not.toContainText("Processing");
  expect(posts).toBe(1);
});
