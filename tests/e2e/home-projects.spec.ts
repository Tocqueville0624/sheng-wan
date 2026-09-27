import { expect, test } from "@playwright/test";

test("Projects and Playground keep separate links, keyboard focus and active states", async ({
  page
}) => {
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  const toggle = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await toggle.isVisible()) await toggle.click();
  const projects = navigation.getByRole("button", { name: "Projects", exact: true });
  const playground = navigation.getByRole("button", { name: "Playground", exact: true });
  const projectsMenu = page.locator("#projects-links");
  const playgroundMenu = page.locator("#playground-links");
  await expect(navigation.locator("[data-nav-dropdown]")).toHaveText(["Projects", "Playground"]);
  await projects.press("Enter");
  await expect(projectsMenu).toBeVisible();
  await expect(projects).toHaveAttribute("aria-expanded", "true");
  await expect(projectsMenu.getByRole("link")).toHaveCount(2);
  await expect(projectsMenu).toContainText("PyTorch");
  await expect(projectsMenu).toContainText("PySpark");
  await page.keyboard.press("Tab");
  await expect(projectsMenu.getByRole("link", { name: /Amelia/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(projectsMenu).toBeHidden();
  await expect(projects).toBeFocused();

  await projects.press("Enter");
  await playground.press("Enter");
  await expect(playgroundMenu).toBeVisible();
  await expect(projectsMenu).toBeHidden();
  await expect(projects).toHaveAttribute("aria-expanded", "false");
  await expect(playgroundMenu.getByRole("link")).toHaveCount(2);
  await expect(playgroundMenu.getByRole("link", { name: /Thales/ })).toBeVisible();
  await expect(playgroundMenu.getByRole("link", { name: "Hugo, Le Chatssius" })).toBeVisible();
  await projects.press("Enter");
  await expect(playgroundMenu).toBeHidden();
  await projectsMenu.getByRole("link", { name: /Amelia/ }).click();
  await expect(page).toHaveURL(/\/playground\/amelia-torch\/?$/);
  if (await toggle.isVisible()) await toggle.click();
  await expect(projects).toHaveAttribute("data-active", "true");
  await expect(playground).not.toHaveAttribute("data-active");
  await expect(projectsMenu.locator('[aria-current="page"]')).toHaveAttribute(
    "href",
    "/playground/amelia-torch"
  );
  await page.goto("/playground/hugo-le-chatssius/");
  if (await toggle.isVisible()) await toggle.click();
  await expect(playground).toHaveAttribute("data-active", "true");
  await expect(projects).not.toHaveAttribute("data-active");
});

test("homepage project cards expose evidence and source code without crowding the layout", async ({
  page
}) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const width of [320, 841, 1041, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const section = page.locator("#personal-projects");
      await expect(section.getByRole("heading", { level: 2 })).toHaveText("Personal Projects");
      await expect(section.getByRole("article")).toHaveCount(2);
      await expect(section).toContainText("PyTorch");
      await expect(section).toContainText("PySpark");
      await expect(section).toContainText("+13.01 pp");
      await expect(section).toContainText("Offline public-label evaluation");
      await expect(section.getByRole("link", { name: /Read project: Amelia/ })).toHaveAttribute(
        "href",
        "/playground/amelia-torch/"
      );
      await expect(
        section.getByRole("link", { name: "Read project: Product Search Quality Analysis" })
      ).toHaveAttribute("href", "/playground/product-search-quality/");
      await expect(section.getByRole("link", { name: /Amelia.*on GitHub/ })).toHaveAttribute(
        "href",
        "https://github.com/Tocqueville0624/amelia-torch"
      );
      await expect(
        section.getByRole("link", { name: "Product Search Quality Analysis on GitHub" })
      ).toHaveAttribute("href", "https://github.com/Tocqueville0624/product-search-quality");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
      ).toBe(true);
      for (const card of await section.getByRole("article").all())
        expect(
          await card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
        ).toBe(true);
      const toggle = page.getByRole("button", { name: "Open navigation", exact: true });
      if (await toggle.isVisible()) await toggle.click();
      await page.getByRole("button", { name: "Projects", exact: true }).click();
      const box = await page.locator("#projects-links").boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      if (await toggle.isVisible()) await toggle.click();
    }
  }
  await page.getByRole("link", { name: "Personal Projects", exact: true }).click();
  await expect(page).toHaveURL(/#personal-projects$/);
});
