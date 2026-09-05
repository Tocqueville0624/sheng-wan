import { expect, test } from "@playwright/test";
import type { CompanyResponse } from "../../src/features/finance/v2-types";
import { buildStatementFlow, layoutStatementFlow } from "../../src/features/finance/chart-model";
import { statementPeriod, validateV2 } from "../../scripts/finance/v2-model";

// Opt-in: reads already-imported local data. Never queues tasks or touches SEC.
test("live imported history retains readable geometry and truthful chart capabilities", async ({
  page,
  request
}, testInfo) => {
  test.skip(process.env.FINANCE_LIVE_CHECK !== "1" || testInfo.project.name !== "desktop");
  test.setTimeout(120000);
  const results: Record<string, unknown> = {};
  for (const ticker of [
    "AAPL",
    "MSFT",
    "GOOGL",
    "AMZN",
    "META",
    "NVDA",
    "TSM",
    "WMT",
    "JPM",
    "BRK.B"
  ]) {
    const response = await request.get(`/api/finance/v2/companies/${ticker}`);
    expect(response.ok()).toBe(true);
    const data = (await response.json()) as CompanyResponse;
    expect(data.company, `${ticker} must already have been imported locally`).toBeTruthy();
    const company = data.company!;
    validateV2(company);
    await page.route(`**/api/finance/v2/companies/${ticker}`, (route) =>
      route.fulfill({ json: data })
    );
    await page.goto(`/playground/thales-olive/?ticker=${ticker}`);
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await expect(page.locator(".company-summary")).toContainText(company.name);
    let checked = 0;
    for (const kind of ["annual", "quarterly"] as const) {
      if (!company[kind].length) continue;
      await page
        .getByRole("button", { name: new RegExp(`^${kind === "annual" ? "Annual" : "Quarterly"}`) })
        .click();
      for (const p of company[kind]) {
        await page.getByRole("combobox", { name: "Period", exact: true }).selectOption(p.id);
        await expect(page.locator(".company-summary")).toContainText(p.label);
        if (!p.coverage.sankey) {
          await expect(page.locator(".flow-chart")).toHaveCount(0);
          continue;
        }
        const period = statementPeriod(p)!;
        const model = buildStatementFlow(period);
        if (!model.ok) throw new Error(model.reason);
        const graph = layoutStatementFlow(model.graph);
        await expect(page.locator(".flow-chart")).toBeVisible();
        const geometry = await page.locator(".flow-chart").evaluate((svg, graph) => {
          const bounds = (svg as SVGSVGElement).viewBox.baseVal;
          const labels = [...svg.querySelectorAll("text")].map((text) => ({
            text: text.textContent,
            box: text.getBBox()
          }));
          const clipped = labels
            .filter(
              ({ box }) =>
                box.x < 0 ||
                box.y < 0 ||
                box.x + box.width > bounds.width ||
                box.y + box.height > bounds.height
            )
            .map((l) => l.text);
          const overlap = labels.flatMap((a, i) =>
            labels
              .slice(i + 1)
              .filter(
                (b) =>
                  Math.min(a.box.x + a.box.width, b.box.x + b.box.width) -
                    Math.max(a.box.x, b.box.x) >
                    1 &&
                  Math.min(a.box.y + a.box.height, b.box.y + b.box.height) -
                    Math.max(a.box.y, b.box.y) >
                    1
              )
              .map((b) => [a.text, b.text])
          );
          const paths = [...svg.querySelectorAll(":scope > path")].filter(
            (p) => p.getAttribute("fill") !== "none"
          );
          return {
            clipped,
            overlap,
            pathsMatch:
              paths.length === graph.links.length &&
              paths.every((p, i) => p.getAttribute("d") === graph.links[i].path)
          };
        }, graph);
        expect(geometry, `${ticker} ${p.label}`).toEqual({
          clipped: [],
          overlap: [],
          pathsMatch: true
        });
        checked++;
      }
    }
    results[ticker] = {
      annual: company.annual.length,
      quarterly: company.quarterly.length,
      renderedSankeys: checked,
      version: company.version
    };
  }
  await testInfo.attach("live-finance-coverage", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json"
  });
});
