import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { expect, test, type Page } from "@playwright/test";
import snapshot from "../../src/data/generated/finance.json" with { type: "json" };
import type { FinanceManifest } from "../../src/features/finance/types";
import { buildStatementFlow, layoutStatementFlow } from "../../src/features/finance/chart-model";
import { mockFinance } from "./finance-fixtures";
test.beforeEach(async ({ page }) => {
  await mockFinance(page);
});

const apple = (snapshot as FinanceManifest).companies.find((company) => company.ticker === "AAPL")!;
const companies = (snapshot as FinanceManifest).companies;

async function openCharts(page: Page) {
  await page.goto("/playground/thales-olive/?ticker=AAPL");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(page.locator(".history-chart")).toBeVisible();
}

test("verified charts preserve available periods, sources, and hydration", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await openCharts(page);
  await expect(page.locator(".table-panel tbody tr")).toHaveCount(apple.annual.length);
  await expect(page.locator(".history-chart")).toContainText("iPhone");
  await expect(page.locator(".history-chart")).toContainText("Services");
  await expect(page.locator(".history-chart")).not.toContainText("Net margin");
  await expect(page.locator(".flow-chart")).toContainText("Gross profit");
  await expect(page.locator(".flow-chart")).toContainText("Operating profit");
  await expect(page.locator(".flow-chart")).toContainText("Pretax profit");
  await expect(page.locator(".flow-chart")).toContainText("Income tax");
  await expect(page.locator(".finance-artboard a")).toHaveCount(0);
  await page.getByRole("button", { name: /^Quarterly/ }).click();
  await expect(page.locator(".table-panel tbody tr")).toHaveCount(apple.quarterly.length);
  for (const period of apple.quarterly) {
    await expect(page.locator(".history-chart")).toContainText(period.segmentSourceUrl!);
  }
  const tinyGain = apple.quarterly.find((period) => {
    const gain = period.metrics.pretaxIncome - period.metrics.operatingIncome;
    return gain > 0 && gain / period.metrics.revenue < 0.001;
  });
  if (tinyGain) {
    await page.getByRole("combobox", { name: "Period", exact: true }).selectOption(tinyGain.id);
    await expect(page.locator(".flow-chart")).toContainText(tinyGain.label);
    await expect(page.locator(".flow-chart")).toContainText("<0.1%");
  }
  expect(errors).toEqual([]);
});

test("both charts export self-contained SVG and high-resolution PNG", async ({
  page
}, testInfo) => {
  await openCharts(page);
  await page.getByRole("button", { name: /^Quarterly/ }).click();
  for (const [panel, filename] of [
    [".history-panel", "revenue"],
    [".flow-panel", "income-statement"]
  ]) {
    for (const format of ["SVG", "PNG"]) {
      const pending = page.waitForEvent("download");
      await page.locator(panel).getByRole("button", { name: format, exact: true }).click();
      const downloaded = await pending;
      expect(await downloaded.failure()).toBeNull();
      expect(downloaded.suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));
      const path = testInfo.outputPath(`${filename}.${format.toLowerCase()}`);
      await downloaded.saveAs(path);
      await testInfo.attach(`${filename}-${format}`, {
        path,
        contentType: format === "SVG" ? "image/svg+xml" : "image/png"
      });
      if (format === "SVG") {
        const svg = await readFile(path, "utf8");
        expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(svg).toContain("REPORTED COMPANY DATA");
        expect(svg).toContain("Thales’ Olive");
        expect(svg).toContain("http");
        expect(svg).not.toContain("var(--");
        expect(svg).not.toContain("DEMONSTRATION");
        if (filename === "revenue") {
          for (const period of apple.quarterly) expect(svg).toContain(period.segmentSourceUrl!);
        }
      } else {
        const info = await sharp(path).metadata();
        expect(info.format).toBe("png");
        expect(info.width).toBe(4440);
        expect(info.height).toBeGreaterThan(2000);
      }
    }
  }
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("every supported company has source-backed business bars, never synthetic results", async ({
  page
}) => {
  await openCharts(page);
  for (const company of companies) {
    expect(company.dataStatus).toBe("verified");
    await page.locator(`[data-ticker="${company.ticker}"]`).click();
    for (const kind of ["Annual", "Quarterly"] as const) {
      if (!company[kind === "Annual" ? "annual" : "quarterly"].length) continue;
      await page.getByRole("button", { name: new RegExp(`^${kind}`) }).click();
      await expect(page.locator(".history-chart")).toBeVisible();
      await expect(page.locator(".history-chart")).toContainText("REPORTED COMPANY DATA");
      await expect(page.locator(".history-chart")).not.toContainText("Unavailable");
      await expect(page.locator(".data-banner--demo")).toHaveCount(0);
      await expect(page.locator(".flow-chart")).toBeVisible();
      const clipped = await page.locator(".history-chart").evaluate((svg) => {
        const viewBox = (svg as SVGSVGElement).viewBox.baseVal;
        return Array.from(svg.querySelectorAll("text"))
          .filter((text) => {
            const box = text.getBBox();
            const height = text.closest("[data-export-only]")
              ? Number(svg.getAttribute("data-export-height"))
              : viewBox.height;
            return (
              box.x < 0 ||
              box.y < 0 ||
              box.x + box.width > viewBox.width ||
              box.y + box.height > height
            );
          })
          .map((text) => text.textContent);
      });
      expect(clipped, `${company.ticker} ${kind} bar export`).toEqual([]);
      if (company.ticker === "TSM") {
        await expect(page.locator(".history-chart")).toContainText("TWD/USD");
        await expect(page.locator(".flow-chart")).toContainText("Federal Reserve H.10");
      }
    }
  }
});

test("all sourced statement labels remain separate, including exceptional adjustments", async ({
  page
}) => {
  test.setTimeout(60_000);
  await openCharts(page);
  for (const company of companies) {
    await page.locator(`[data-ticker="${company.ticker}"]`).click();
    for (const kind of ["Annual", "Quarterly"]) {
      const periods = kind === "Annual" ? company.annual : company.quarterly;
      if (!periods.length) continue;
      await page.getByRole("button", { name: new RegExp(`^${kind}`) }).click();
      for (const period of periods) {
        await page.getByRole("combobox", { name: "Period", exact: true }).selectOption(period.id);
        await expect(
          page.locator(".flow-chart"),
          `${company.ticker} ${period.label}`
        ).toBeVisible();
        // Let the new SVG geometry reach paint before reading browser hit-test
        // caches; React attributes can update a frame before isPointInFill does.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            )
        );
        const model = buildStatementFlow(period);
        if (!model.ok) throw new Error(`${company.ticker} ${period.id}: ${model.reason}`);
        const layout = layoutStatementFlow(model.graph);
        const geometry = await page.locator(".flow-chart").evaluate((svg, graph) => {
          const labels = Array.from(svg.querySelectorAll("text")).map((text) => ({
            text: text.textContent,
            box: text.getBBox()
          }));
          const intersections = labels.flatMap((label, index) =>
            labels
              .slice(index + 1)
              .filter(
                (other) =>
                  Math.min(label.box.x + label.box.width, other.box.x + other.box.width) -
                    Math.max(label.box.x, other.box.x) >
                    1 &&
                  Math.min(label.box.y + label.box.height, other.box.y + other.box.height) -
                    Math.max(label.box.y, other.box.y) >
                    1
              )
              .map((other) => [label.text, other.text])
          );
          const bounds = (svg as SVGSVGElement).viewBox.baseVal;
          const clipped = labels
            .filter(
              ({ box }) =>
                box.x < 0 ||
                box.y < 0 ||
                box.x + box.width > bounds.width ||
                box.y + box.height > bounds.height
            )
            .map(({ text }) => text);
          const paths = Array.from(svg.querySelectorAll<SVGPathElement>(":scope > path")).filter(
            (path) => path.getAttribute("fill") !== "none"
          );
          const modelMatches =
            paths.length === graph.links.length &&
            paths.every((path, index) => path.getAttribute("d") === graph.links[index].path);
          const leaders = Array.from(
            svg.querySelectorAll<SVGPathElement>(":scope > path[stroke-dasharray]")
          );
          const expectedLeaders = graph.links.filter((link) => link.width < 0.75);
          const leaderModelMatches =
            leaders.length === expectedLeaders.length &&
            leaders.every(
              (path, index) => path.getAttribute("d") === expectedLeaders[index].annotationPath
            );
          // A subpixel ribbon or its dotted leader can cross a label even when
          // coarse filled-area sampling misses it. Sample the actual rendered
          // trajectories too; a leader is not exempt just because it is non-quantitative.
          const thinFlowCoveredLabels = new Set<string | null>();
          if (modelMatches) {
            const thinPaths = paths.filter((_, index) => graph.links[index].width <= 2);
            for (const path of [...thinPaths, ...leaders]) {
              const length = path.getTotalLength();
              for (let distance = 0; distance <= length; distance += 2) {
                const point = path.getPointAtLength(distance);
                for (const label of labels) {
                  const box = label.box;
                  if (
                    point.x > box.x + 0.3 &&
                    point.x < box.x + box.width - 0.3 &&
                    point.y > box.y + 0.3 &&
                    point.y < box.y + box.height - 0.3
                  ) {
                    thinFlowCoveredLabels.add(label.text);
                  }
                }
              }
            }
          }
          const interceptedNodes: string[] = [];
          const coveredLabels: (string | null)[] = [];
          if (modelMatches)
            paths.forEach((path, index) => {
              const link = graph.links[index];
              const box = path.getBBox();
              const intersects = (
                x: number,
                y: number,
                width: number,
                height: number,
                step: number
              ) => {
                const startX = Math.max(x + 0.3, box.x);
                const endX = Math.min(x + width - 0.3, box.x + box.width);
                const startY = Math.max(y + 0.3, box.y);
                const endY = Math.min(y + height - 0.3, box.y + box.height);
                for (
                  let px = startX;
                  px <= endX;
                  px += Math.min(step, Math.max(0.3, (endX - startX) / 2))
                ) {
                  for (
                    let py = startY;
                    py <= endY;
                    py += Math.min(step, Math.max(0.3, (endY - startY) / 2))
                  ) {
                    if (path.isPointInFill(new DOMPoint(px, py))) return true;
                  }
                }
                return false;
              };
              for (const node of graph.nodes) {
                if (
                  node.id !== link.source &&
                  node.id !== link.target &&
                  node.height >= 0.75 &&
                  intersects(node.x, node.y, graph.nodeWidth, node.height, 3)
                )
                  interceptedNodes.push(`${link.source}→${link.target}: ${node.id}`);
              }
              if (link.width > 2)
                for (const label of labels) {
                  if (intersects(label.box.x, label.box.y, label.box.width, label.box.height, 5))
                    coveredLabels.push(label.text);
                }
            });
          return {
            modelMatches,
            leaderModelMatches,
            intersections,
            clipped,
            interceptedNodes,
            coveredLabels,
            thinFlowCoveredLabels: [...thinFlowCoveredLabels]
          };
        }, layout);
        expect(geometry, `${company.ticker} ${period.label}`).toEqual({
          modelMatches: true,
          leaderModelMatches: true,
          intersections: [],
          clipped: [],
          interceptedNodes: [],
          coveredLabels: [],
          thinFlowCoveredLabels: []
        });
      }
    }
  }
});
