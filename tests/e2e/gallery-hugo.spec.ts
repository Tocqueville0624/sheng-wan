import { expect, test } from "@playwright/test";

test("gallery preserves complete photographs in compact editorial rows without numeric overlays", async ({
  page
}) => {
  await page.goto("/playground/photo-gallery/?view=contact");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(page.locator(".contact-sheet button")).toHaveCount(16);
  await expect(page.locator(".contact-sheet button > span")).toHaveCount(0);
  await page.getByRole("button", { name: "Editorial", exact: true }).click();
  await expect(page).not.toHaveURL(/view=contact/);
  await expect(page.locator(".editorial-photo")).toHaveCount(16);
  await expect(page.locator(".editorial-row")).toHaveCount(7);

  const photoRatios = await page.locator(".editorial-photo img").evaluateAll((images) =>
    images.map((image) => {
      const photo = image as HTMLImageElement;
      const style = getComputedStyle(photo);
      return {
        displayed: Number.parseFloat(style.width) / Number.parseFloat(style.height),
        original: Number(photo.getAttribute("width")) / Number(photo.getAttribute("height"))
      };
    })
  );
  for (const { displayed, original } of photoRatios) {
    expect(Math.abs(displayed - original)).toBeLessThan(0.01);
  }
  await expect(page.locator(".editorial-photo > span")).toHaveCount(0);
});

test("gallery view URLs and focus view keyboard controls remain usable", async ({ page }) => {
  await page.goto("/playground/photo-gallery/");
  // The static toolbar appears before Astro attaches React's event listeners.
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByRole("button", { name: "Contact sheet", exact: true }).click();
  await expect(page).toHaveURL(/view=contact/);
  await page.reload();
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Contact sheet", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.locator(".contact-sheet button").first().click();
  await expect(page.getByRole("dialog")).toHaveAttribute("aria-label", "Photograph 1 of 16");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog")).toHaveAttribute("aria-label", "Photograph 2 of 16");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("dialog")).toHaveAttribute("aria-label", "Photograph 1 of 16");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".contact-sheet button").first()).toBeFocused();
});

test("Hugo's photo wall preserves the carrier portrait and crops only the sofa photograph", async ({
  page
}) => {
  await page.goto("/playground/hugo-le-chatssius/");
  await expect(page.locator(".hugo-polaroid")).toHaveCount(5);
  const carrier = await page.locator(".hugo-polaroid--hugo-backpack img").evaluate((element) => {
    const photo = element as HTMLImageElement;
    const style = getComputedStyle(photo);
    return {
      displayed: Number.parseFloat(style.width) / Number.parseFloat(style.height),
      original: Number(photo.getAttribute("width")) / Number(photo.getAttribute("height")),
      transform: style.transform
    };
  });
  expect(Math.abs(carrier.displayed - carrier.original)).toBeLessThan(0.01);
  expect(carrier.transform).toBe("none");

  const sofa = page.locator(".hugo-polaroid--hugo-cushions img");
  await expect(sofa).toHaveCSS("object-fit", "cover");
  expect(await sofa.evaluate((photo) => getComputedStyle(photo).transform)).not.toBe("none");
  await expect(page.locator(".hugo-wall-birds .dove-mark")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".hugo-wall-birds .dove-mark")).toHaveAttribute("focusable", "false");
});

test("gallery and Hugo layouts stay within the viewport in both themes", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const width of [320, 390, 840, 841, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ["/playground/photo-gallery/", "/playground/hugo-le-chatssius/"]) {
        await page.goto(route);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
          )
        ).toBe(true);
      }
    }
  }
});
