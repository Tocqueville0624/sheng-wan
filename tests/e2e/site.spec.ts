import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import snapshot from "../../src/data/generated/finance.json" with { type: "json" };
import { mockFinance } from "./finance-fixtures";
test.beforeEach(async ({ page }) => {
  await mockFinance(page);
});

test("blocked localStorage falls back to a usable system theme and session toggle", async ({
  page,
  isMobile
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      }
    });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  // Without a stored override, CSS follows the system preference directly.
  expect(
    await page
      .locator("html")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--background").trim())
  ).toBe("#0f1c26");
  if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: /theme/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(errors).toEqual([]);
});

test("finance controls, long source labels and search results fit small screens in both themes", async ({
  page
}) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 820 });
      await page.goto("/playground/thales-olive/");
      await page.getByRole("searchbox").fill("Bank");
      await expect(page.locator("[data-ticker]").first()).toBeVisible();
      // Wait for the independent company request too: changing disabled state
      // while axe samples opacity can produce a false contrast failure.
      await expect(page.getByRole("button", { name: "Check latest SEC filings" })).toBeEnabled();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
      ).toBe(true);
      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""))
      ).toEqual([]);
    }
  }
});

const routes = [
  "/",
  "/cv",
  "/research",
  "/teaching",
  "/playground",
  "/playground/hugo-le-chatssius",
  "/playground/photo-gallery",
  "/playground/thales-olive"
];

for (const route of routes) {
  test(`${route} renders without serious accessibility violations`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("h1")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((item) => ["critical", "serious"].includes(item.impact ?? ""))
    ).toEqual([]);
  });
}

test("theme and Playground interactions work", async ({ page }) => {
  await page.goto("/playground/thales-olive");
  await page.getByRole("button", { name: /Microsoft/ }).click();
  await expect(page.getByRole("heading", { name: "Microsoft" })).toBeVisible();
  await page.getByRole("button", { name: /Quarterly/ }).click();
  await expect(page.locator(".table-panel tbody tr")).toHaveCount(
    snapshot.companies.find((company) => company.ticker === "MSFT")!.quarterly.length
  );
  const theme = page.getByRole("button", { name: /theme/i });
  if (!(await theme.isVisible()))
    await page.getByRole("button", { name: "Open navigation" }).click();
  await theme.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", /dark|light/);
});

test("decorative birds remain accessible and contained across breakpoints", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const width of [320, 390, 840, 841, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ["/", "/not-a-real-page"]) {
        await page.goto(route);
        for (const bird of await page.locator(".dove-mark").all()) {
          await expect(bird).toHaveAttribute("aria-hidden", "true");
          await expect(bird).toHaveAttribute("focusable", "false");
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
          )
        ).toBe(true);
        await expect(
          page.locator(".hero-doves a, .footer-doves a, .dove-mark [tabindex]")
        ).toHaveCount(0);
      }
    }
  }
});

test("Playground dropdown works with keyboard, pointer and touch-sized navigation", async ({
  page,
  isMobile
}) => {
  await page.goto("/");
  if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
  const trigger = page.getByRole("button", { name: "Playground", exact: true });
  const menu = page.locator("#playground-links");
  await trigger.press("Enter");
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("link")).toHaveCount(3);
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("link", { name: "Thales’ Olive" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  if (isMobile) await trigger.press("Enter");
  else await trigger.hover();
  await expect(menu).toBeVisible();
  await menu.getByRole("link", { name: "Hugo, Le Chatssius" }).click();
  await expect(page).toHaveURL(/hugo-le-chatssius/);
  await page.goto("/playground/");
  await expect(page).toHaveURL(/playground\/thales-olive\//);
});

test("requested typography, contact icons and simple controls are preserved", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".wordmark")).toContainText("Political Science");
  await expect(page.locator(".wordmark-mark")).toHaveCount(0);
  await expect(page.locator(".home-interests")).toHaveText(
    "Political Theory, Gender Equality, Digital Space"
  );
  await expect(page.getByRole("link", { name: "Explore research" })).toHaveCount(0);
  await expect(page.locator(".contact-row")).toContainText("Contact Me:");
  await expect(page.locator(".contact-row .social-links a")).toHaveCount(3);
  await expect(page.locator(".site-footer .contact-icon")).toHaveCount(3);
  for (const link of await page.locator(".social-links a").all()) {
    await expect(link).toHaveAttribute("aria-label", /Email|LinkedIn|GitHub/);
  }
  await page.goto("/cv/");
  expect(
    await page.locator(".cv-header h1").evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  ).toBeLessThan(80);
  expect(
    await page
      .getByRole("link", { name: "Download PDF" })
      .evaluate((el) => parseFloat(getComputedStyle(el).borderRadius))
  ).toBeLessThanOrEqual(8);
  await page.goto("/research/");
  expect(
    await page
      .locator(".tag")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor)
  ).toBe("rgba(0, 0, 0, 0)");
  await page.goto("/playground/thales-olive/");
  await expect(page.getByRole("heading", { name: "Can PhDs Be Rich?" })).toBeVisible();
  await expect(page.locator("blockquote a")).toHaveCount(0);
  await expect(page.locator("blockquote")).toContainText("“Thales");
  await expect(page.getByRole("button", { name: /Tesla/ })).toHaveCount(0);
});
