import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import bundled from "../../src/data/generated/finance.json" with { type: "json" };
import { mockFinance, savedCompanies } from "./finance-fixtures";
import catalog from "../../src/data/generated/finance-catalog.json" with { type: "json" };

test("every company logo clears all chart text and survives offline SVG/PNG export", async ({
  page,
  context
}, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  // The online directory can supply longer legal/share-class names than the bundle.
  await mockFinance(
    page,
    Object.fromEntries(
      savedCompanies.map((company) => [
        company.ticker,
        {
          ...company,
          name: catalog.companies.find((entry) => entry.ticker === company.ticker)!.name
        }
      ])
    )
  );
  await page.goto("/playground/thales-olive/");
  await expect(page.getByRole("button", { name: "Check latest SEC filings" })).toBeEnabled();
  const offline = await context.newPage();
  await offline.route("http://**/*", (route) => route.abort());
  await offline.route("https://**/*", (route) => route.abort());
  for (const company of bundled.companies) {
    await page.locator(`[data-ticker="${company.ticker}"]`).click();
    for (const kind of ["annual", "quarterly"] as const) {
      await page
        .getByRole("button", { name: kind === "annual" ? /^Annual \(/ : /^Quarterly \(/ })
        .click();
      for (const selector of [".history-chart", ".flow-chart"]) {
        const svg = page.locator(selector);
        const logo = svg.locator(`[data-company-logo="${company.ticker}"]`);
        await expect(logo).toHaveCount(1);
        const check = await svg.evaluate((el) => {
          const image = el.querySelector("[data-company-logo]") as SVGGraphicsElement;
          const box = (image.parentElement as unknown as SVGGraphicsElement).getBBox();
          const intersections = [...el.querySelectorAll("text")]
            .filter((text) => {
              const rect = text.getBBox();
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                box.x < rect.x + rect.width &&
                box.x + box.width > rect.x &&
                box.y < rect.y + rect.height &&
                box.y + box.height > rect.y
              );
            })
            .map((text) => text.textContent);
          return { intersections, x: box.x, y: box.y, width: box.width, height: box.height };
        });
        expect(check.intersections, `${company.ticker} ${kind} ${selector}`).toEqual([]);
        const group = page.getByRole("group", {
          name:
            selector === ".history-chart"
              ? "Download business revenue chart"
              : "Download income statement Sankey"
        });
        for (const format of ["SVG", "PNG"] as const) {
          const downloadPromise = page.waitForEvent("download");
          await group.getByRole("button", { name: format, exact: true }).click();
          const download = await downloadPromise;
          const path = testInfo.outputPath(
            `${company.ticker}-${kind}-${selector.slice(1)}.${format.toLowerCase()}`
          );
          await download.saveAs(path);
          const bytes = Buffer.from(await readFile(path));
          let crop: Buffer;
          if (format === "SVG") {
            const source = bytes.toString("utf8");
            expect(source).toContain(`data-company-logo="${company.ticker}"`);
            expect(source).not.toMatch(/<image[^>]+href=["']https?:/);
            await offline.goto(`data:image/svg+xml;base64,${bytes.toString("base64")}`);
            const image = offline.locator(`[data-company-logo="${company.ticker}"]`);
            await image.evaluate(async (el) => {
              const checkImage = new Image();
              checkImage.src = el.getAttribute("href")!;
              await checkImage.decode();
            });
            crop = await image.screenshot();
          } else {
            crop = await sharp(bytes)
              .extract({
                left: Math.floor(check.x * 3),
                top: Math.floor(check.y * 3),
                width: Math.floor(check.width * 3),
                height: Math.floor(check.height * 3)
              })
              .png()
              .toBuffer();
          }
          const stats = await sharp(crop).stats();
          expect(
            Math.max(...stats.channels.slice(0, 3).map((channel) => channel.stdev)),
            `${company.ticker} ${kind} ${selector} ${format} has visible original artwork`
          ).toBeGreaterThan(5);
        }
      }
    }
  }
  await offline.close();
});
