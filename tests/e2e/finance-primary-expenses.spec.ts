import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { reviewedFixture } from "../fixtures/finance/reviewed-fixtures";
import { mockFinance } from "./finance-fixtures";

for (const key of [
  "HSYPrimaryExpensesAnnual",
  "APHPrimaryExpensesAnnual",
  "IEXPrimaryExpensesAnnual",
  "HSYPrimaryExpenses2024Q1"
] as const)
  test(`${key}: original primary expense partition renders and exports`, async ({ page }, info) => {
    const { company, period } = reviewedFixture(key);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockFinance(page, { [company.ticker]: company });
    await page.goto(
      `/playground/thales-olive/?ticker=${company.ticker}&period=${period.kind}&statement=${period.id}`
    );
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await expect(page.locator(".company-summary h2")).toHaveText(company.name);
    await expect(page.locator(".flow-period-select select")).toHaveValue(period.id);
    const chart = page.locator(".flow-chart");
    await expect(chart).toBeVisible();
    const metadata = JSON.parse((await chart.locator("metadata").textContent())!);
    expect(metadata.metrics).toEqual(period.metrics);
    expect(metadata.operatingExpenseDetails).toEqual(period.operatingExpenseDetails);
    expect(
      metadata.nodes
        .filter((node: { group: string }) => node.group === "detail")
        .map((node: { amount: number }) => node.amount)
    ).toEqual(period.operatingExpenseDetails!.map((line) => line.amount));
    expect(metadata.nodes.some((node: { id: string }) => node.id === "rd")).toBe(false);
    const revenueHeight = Number(
      await chart.locator('[data-flow-bar="revenue"]').getAttribute("height")
    );
    const expensesHeight = Number(
      await chart.locator('[data-flow-bar="opex"]').getAttribute("height")
    );
    for (const line of period.operatingExpenseDetails!) {
      const node = metadata.nodes.find(
        (node: { group: string; label: string; amount: number; id: string }) =>
          node.group === "detail" && node.label === line.label && node.amount === line.amount
      );
      expect(node).toBeDefined();
      const height = Number(
        await chart.locator(`[data-flow-bar="${node.id}"]`).getAttribute("height")
      );
      expect(height / expensesHeight).toBeCloseTo(
        line.amount / period.metrics.operatingExpenses!,
        9
      );
    }
    for (const segment of period.segments ?? []) {
      const height = Number(
        await chart.locator(`[data-flow-bar="segment-${segment.id}"]`).getAttribute("height")
      );
      expect(height / revenueHeight).toBeCloseTo(segment.revenue / period.metrics.revenue!, 9);
    }
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
      ).toBe(true);
      const clipped = await chart.evaluate((element) => {
        const { width, height } = (element as SVGSVGElement).viewBox.baseVal;
        return [...element.querySelectorAll("text")]
          .filter((text) => {
            const b = text.getBBox();
            return b.x < -1 || b.y < -1 || b.x + b.width > width + 1 || b.y + b.height > height + 1;
          })
          .map((text) => text.textContent);
      });
      expect(clipped).toEqual([]);
      const overlaps = await chart.evaluate((element) => {
        const texts = [...element.querySelectorAll("[data-flow-node] text")];
        return texts.flatMap((a, index) =>
          texts.slice(index + 1).flatMap((b) => {
            if (a.parentElement === b.parentElement) return [];
            const x = (a as SVGTextElement).getBBox(),
              y = (b as SVGTextElement).getBBox();
            return Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x) > 0.5 &&
              Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y) > 0.5
              ? [[a.textContent, b.textContent]]
              : [];
          })
        );
      });
      expect(overlaps).toEqual([]);
    }
    await page
      .locator(".flow-panel")
      .screenshot({ path: info.outputPath(`${company.ticker}-primary-expenses.png`) });
    for (const format of ["SVG", "PNG"] as const) {
      const pending = page.waitForEvent("download");
      await page
        .getByRole("group", { name: "Download income statement Sankey" })
        .getByRole("button", { name: format, exact: true })
        .click();
      const download = await pending;
      expect(await download.failure()).toBeNull();
      const path = info.outputPath(`${company.ticker}-primary-expenses.${format.toLowerCase()}`);
      await download.saveAs(path);
      if (format === "SVG") {
        const svg = await readFile(path, "utf8");
        const exported = await page.evaluate(
          (source) =>
            JSON.parse(
              new DOMParser().parseFromString(source, "image/svg+xml").querySelector("metadata")!
                .textContent!
            ),
          svg
        );
        expect(exported).toEqual(metadata);
        expect(svg).toContain(period.sourceUrl);
      } else {
        const image = await sharp(path).metadata();
        expect(image.format).toBe("png");
        expect(image.width).toBeGreaterThan(3000);
      }
    }
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download CSV", exact: true }).click();
    const download = await pending;
    expect(await download.failure()).toBeNull();
    const path = info.outputPath(`${company.ticker}-primary-expenses.csv`);
    await download.saveAs(path);
    const rows = (await readFile(path, "utf8"))
      .split("\n")
      .map((line) =>
        [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map((match) =>
          match[1]!.replaceAll('""', '"')
        )
      );
    expect(JSON.parse(rows[1]![rows[0]!.indexOf("operating_expense_lines")]!)).toEqual(
      period.operatingExpenseDetails
    );
    expect(errors).toEqual([]);
  });
