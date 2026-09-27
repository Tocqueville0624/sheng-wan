import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("search-quality budgets preserve equal comparisons and distinguish uncertainty", async ({
  page
}) => {
  await page.goto("/playground/product-search-quality/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Product Search Quality Analysis"
  );
  await expect(page).toHaveTitle("Product Search Quality Analysis — Sheng Wan");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Product Search Quality Analysis — Sheng Wan"
  );
  const selector = page.getByRole("combobox", {
    name: "Review budget within the predicted-Exact pool"
  });
  await expect(selector).toBeVisible();
  await expect(page.locator("[data-yield-panel]:visible")).toHaveCount(1);
  await expect(page.locator("#review-budget-10")).toContainText(
    "95% query-cluster bootstrap interval"
  );
  await selector.selectOption("5");
  await expect(page.locator("#review-budget-5")).toBeVisible();
  await expect(page.locator("#review-budget-10")).toBeHidden();
  await expect(page.locator("#review-budget-5")).toContainText("point estimate");
  await expect(page.locator("#review-budget-5")).toContainText("Analytical expectation");
  await page.getByText("Compare both budgets in a table", { exact: true }).press("Enter");
  await expect(
    page.getByRole("region", { name: "Review budget results" }).getByRole("table")
  ).toBeVisible();
});

test("Amelia comparisons keep each workflow and its limits together", async ({ page }) => {
  await page.goto("/playground/amelia-torch/");
  const selector = page.getByRole("combobox", { name: "Compare a workflow" });
  await expect(selector).toBeVisible();
  await expect(page.locator("[data-benchmark-panel]:visible")).toHaveCount(1);
  await expect(selector).toHaveValue("rtx-native");
  await expect(page.locator("#rtx-native")).toContainText("32.979 to 22.115 seconds");
  for (const id of ["rtx-native", "rtx-hybrid", "native-cuda", "hybrid-cuda", "native-mps"]) {
    await selector.selectOption(id);
    const panel = page.locator(`#${id}`);
    await expect(panel).toBeVisible();
    await expect(page.locator("[data-benchmark-panel]:visible")).toHaveCount(1);
    await expect(panel.locator(".dataset-chart")).toHaveCount(3);
    await expect(panel.getByRole("link", { name: "Read the measurement record" })).toHaveAttribute(
      "href",
      /github\.com\/Tocqueville0624\/amelia-torch\/blob\/[a-f0-9]{40}\//
    );
    await panel.getByText("View the timing table", { exact: true }).press("Enter");
    await expect(panel.getByRole("table")).toBeVisible();
    await expect(panel.getByRole("table").locator("tbody tr")).toHaveCount(3);
  }
  await selector.selectOption("rtx-native");
  await expect(page.locator("#rtx-native table th")).toContainText(["R serial", "CUDA32"]);
  await expect(page.locator("#rtx-native table")).toContainText("20.160");
  await expect(page.locator("#rtx-native table .timing-iqr")).toHaveCount(18);
  await expect(page.locator("#rtx-native .benchmark-data")).toContainText(
    "not confidence intervals"
  );
  await selector.selectOption("rtx-hybrid");
  await expect(page.locator("#rtx-hybrid")).toContainText("110.620 to 101.640 seconds");
  await expect(page.locator("#rtx-hybrid table .timing-iqr")).toHaveCount(12);
  await expect(page.locator("#native-mps")).toContainText(/slower/);
  await selector.selectOption("hybrid-cuda");
  await expect(page.locator("#hybrid-cuda")).toContainText(
    /original Amelia with two R workers was faster/
  );
});

test("project figures remain readable at narrow widths and in both themes", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const width of [320, 390, 840, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["amelia-torch", "product-search-quality"]) {
        await page.goto(`/playground/${path}/`);
        const selector = page.getByRole("combobox");
        await expect(selector).toBeVisible();
        const arrow = page.locator(".project-select-arrow");
        await expect(arrow).toHaveCount(1);
        const selectBox = await selector.boundingBox();
        const arrowBox = await arrow.boundingBox();
        expect(selectBox).not.toBeNull();
        expect(arrowBox).not.toBeNull();
        expect(
          selectBox!.x + selectBox!.width - arrowBox!.x - arrowBox!.width
        ).toBeGreaterThanOrEqual(12);
        expect(arrowBox!.y).toBeGreaterThan(selectBox!.y);
        expect(arrowBox!.y + arrowBox!.height).toBeLessThan(selectBox!.y + selectBox!.height);
        expect(await selector.evaluate((element) => getComputedStyle(element).appearance)).toBe(
          "none"
        );
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
        ).toBe(true);
        for (const figure of await page.locator("figure:visible").all()) {
          expect(
            await figure.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
          ).toBe(true);
        }
        if (width === 320 || width === 1440) {
          const results = await new AxeBuilder({ page }).analyze();
          expect(
            results.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""))
          ).toEqual([]);
        }
      }
    }
  }
});

test("both project pages retain all evidence without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${test.info().project.use.baseURL}/playground/amelia-torch/`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("amelia-torch");
  await expect(page.locator("[data-benchmark-panel]:visible")).toHaveCount(5);
  await expect(page.getByRole("combobox", { name: "Compare a workflow" })).toBeHidden();
  await page.goto(`${test.info().project.use.baseURL}/playground/product-search-quality/`);
  await expect(page.locator("[data-yield-panel]:visible")).toHaveCount(2);
  await expect(page.getByRole("combobox")).toBeHidden();
  await context.close();
});
