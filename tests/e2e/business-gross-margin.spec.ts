import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("business gross margins show sourced values and explicit gaps on the page and in downloads", async ({
  page
}, testInfo) => {
  await page.goto("/playground/thales-olive/?ticker=AAPL&period=annual&statement=FY2025");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  const services = page.locator('[data-flow-node="segment-services"]');
  await expect(services).toContainText("Gross margin: 75.4%");
  await expect(page.locator('[data-flow-node="segment-iphone"]')).toContainText("Gross margin: —");
  await expect(page.locator('[data-flow-node="revenue"]')).not.toContainText("Gross margin:");
  await expect(page.locator(".flow-chart")).not.toContainText("% of profit");
  await page.getByText("View exact amounts and reconciliation", { exact: true }).click();
  const table = page.getByRole("region", { name: "Income statement amounts", exact: true });
  await expect(
    table
      .getByRole("row")
      .filter({ has: page.getByRole("rowheader", { name: "Services", exact: true }) })
  ).toContainText("$82,314,000,000");
  await expect(page.locator(".business-margin-sources")).toContainText("USD 26,844,000,000");
  await expect(page.locator(".business-margin-sources")).toContainText(
    "us-gaap:CostOfGoodsAndServicesSold"
  );

  for (const format of ["SVG", "PNG"]) {
    const pending = page.waitForEvent("download");
    await page
      .getByRole("group", { name: "Download income statement Sankey", exact: true })
      .getByRole("button", { name: format, exact: true })
      .click();
    const download = await pending;
    expect(await download.failure()).toBeNull();
    const path = testInfo.outputPath(`aapl-FY2025-gross-margin.${format.toLowerCase()}`);
    await download.saveAs(path);
    await testInfo.attach(`business-margin-${format}`, {
      path,
      contentType: format === "SVG" ? "image/svg+xml" : "image/png"
    });
    if (format === "SVG") {
      const source = await readFile(path, "utf8");
      const text = await page.evaluate(
        (content) =>
          new DOMParser().parseFromString(content, "image/svg+xml").documentElement.textContent,
        source
      );
      expect(text).toContain("Gross margin: 75.4%");
      expect(text).toContain("Gross margin: —");
      expect(text).toContain("Business gross margin = gross profit ÷ business revenue.");
      expect(text).toContain("unavailable for this category and period");
      expect(source).toContain("aapl-20250927.htm");
      expect(source).toMatch(/href="data:image\//);
      expect(source).not.toMatch(/<image[^>]*href="https?:/);
    }
  }
  await page.locator('[data-ticker="MSFT"]').click();
  await page.getByRole("combobox", { name: "Period", exact: true }).selectOption("FY2026");
  for (const [id, margin] of [
    ["productivity", "82.1%"],
    ["intelligent-cloud", "58.0%"],
    ["personal-computing", "56.6%"]
  ]) {
    await expect(page.locator(`[data-flow-node="segment-${id}"]`)).toContainText(
      `Gross margin: ${margin}`
    );
  }
  await page.getByRole("combobox", { name: "Period", exact: true }).selectOption("FY2020");
  await expect(page.locator('[data-flow-node="segment-intelligent-cloud"]')).toContainText(
    "Gross margin: —"
  );
  const region = page.getByRole("region", {
    name: "Scrollable income statement Sankey",
    exact: true
  });
  await region.focus();
  const left = await region.evaluate((element) => element.scrollLeft);
  await page.keyboard.press("ArrowRight");
  if (await region.evaluate((element) => element.scrollWidth > element.clientWidth)) {
    await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(left);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true
  );
});
