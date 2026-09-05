import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { mockFinance, savedCompanies } from "./finance-fixtures";

test("filing sources are collapsed on screen but complete in standalone downloads", async ({
  page
}, testInfo) => {
  await mockFinance(page);
  await page.goto("/playground/thales-olive/?ticker=MSFT&period=quarterly");
  const panel = page.locator(".history-panel");
  const details = panel.locator("details");
  const register = panel.getByRole("region", {
    name: "Filing source register",
    includeHidden: true
  });
  await expect(panel).toContainText("Microsoft");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(register).toBeHidden();
  const chart = panel.locator("svg.history-chart");
  const sizes = await chart.evaluate((svg) => ({
    screen: (svg as SVGSVGElement).viewBox.baseVal.height,
    exported: Number(svg.getAttribute("data-export-height"))
  }));
  expect(sizes.exported - sizes.screen).toBeGreaterThan(100);
  const summary = details.locator("summary");
  await summary.focus();
  await summary.press("Enter");
  await expect(register).toBeVisible();
  const links = await register
    .locator("a")
    .evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href));
  for (const p of savedCompanies.find((c) => c.ticker === "MSFT")!.quarterly)
    expect(links).toContain(p.segmentSourceUrl ?? p.sourceUrl);
  await summary.press("Enter");
  await expect(register).toBeHidden();
  for (const format of ["SVG", "PNG"]) {
    const pending = page.waitForEvent("download");
    await panel.getByRole("button", { name: format, exact: true }).click();
    const download = await pending;
    const path = testInfo.outputPath(`compact-sources.${format.toLowerCase()}`);
    await download.saveAs(path);
    if (format === "SVG") {
      const svg = await readFile(path, "utf8");
      expect(svg).toContain(`viewBox="0 0 1480 ${sizes.exported}"`);
      expect(svg).not.toContain("display: none");
      expect(svg).not.toMatch(/<g[^>]*data-export-only[^>]*aria-hidden="true"/);
      for (const link of links) expect(svg).toContain(link.replaceAll("&", "&amp;"));
    } else {
      const metadata = await sharp(path).metadata();
      expect(metadata.width).toBe(4440);
      expect(metadata.height).toBe(sizes.exported * 3);
    }
  }
  await expect(register).toBeHidden();
  expect(await chart.evaluate((svg) => (svg as SVGSVGElement).viewBox.baseVal.height)).toBe(
    sizes.screen
  );
});

for (const colorScheme of ["light", "dark"] as const)
  test(`period history shows six rows with independent keyboard scrolling in ${colorScheme} mode`, async ({
    page
  }, testInfo) => {
    const company = structuredClone(savedCompanies.find((c) => c.ticker === "MSFT")!);
    // Test-only repetition exercises a long viewport; it is not a reporting-history fixture.
    company.quarterly = Array.from({ length: 20 }, (_, i) => ({
      ...structuredClone(company.quarterly[i % company.quarterly.length]),
      id: `layout-fixture-${i}`,
      label: `Layout fixture ${i + 1}`,
      segments: undefined,
      coverage: { basics: true, segments: false, sankey: false }
    }));
    await mockFinance(page, { MSFT: company });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/playground/thales-olive/?ticker=MSFT&period=quarterly");
    await expect(page.locator(".table-panel tbody tr")).toHaveCount(20);
    await expect(
      page.getByRole("heading", { name: "Revenue and net income", exact: true })
    ).toHaveCount(0);
    await expect(page.locator(".history-chart")).toHaveCount(0);
    const region = page.getByRole("region", { name: "Financial history table", exact: true });
    await region.scrollIntoViewIfNeeded();
    await region.focus();
    const geometry = await region.evaluate((box) => {
      const header = box.querySelector("thead")!.getBoundingClientRect();
      const row = box.querySelector("tbody tr")!.getBoundingClientRect();
      return {
        visibleRows: (box.clientHeight - header.height) / row.height,
        overflow: box.scrollHeight - box.clientHeight
      };
    });
    expect(geometry.visibleRows).toBeGreaterThanOrEqual(5);
    expect(geometry.visibleRows).toBeLessThanOrEqual(6.1);
    expect(geometry.overflow).toBeGreaterThan(500);
    const pageY = await page.evaluate(() => scrollY);
    await region.press("End");
    await expect
      .poll(() => region.evaluate((box) => box.scrollHeight - box.clientHeight - box.scrollTop))
      .toBeLessThan(2);
    expect(await page.evaluate(() => scrollY)).toBeCloseTo(pageY, 0);
    const bottom = await region.evaluate((box) => ({
      remaining: box.scrollHeight - box.clientHeight - box.scrollTop,
      headerOffset:
        box.querySelector("thead th")!.getBoundingClientRect().top -
        box.getBoundingClientRect().top,
      headerColor: getComputedStyle(box.querySelector("thead th")!).backgroundColor
    }));
    expect(bottom.remaining).toBeLessThan(2);
    expect(bottom.headerOffset).toBeCloseTo(0, 0);
    expect(bottom.headerColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true
    );
    await region.press("Home");
    await expect.poll(() => region.evaluate((box) => box.scrollTop)).toBe(0);
    await page
      .locator(".table-panel")
      .screenshot({ path: testInfo.outputPath(`period-table-${colorScheme}.png`) });
  });
