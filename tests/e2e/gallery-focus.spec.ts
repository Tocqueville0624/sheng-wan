import { expect, test, type Page } from "@playwright/test";

async function photographFit(page: Page) {
  return page.locator(".focus-stage img").evaluate(async (element) => {
    const image = element as HTMLImageElement;
    await image.decode();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const rect = image.getBoundingClientRect();
    const picture = image.parentElement!.getBoundingClientRect();
    const stage = image.closest(".focus-stage")!.getBoundingClientRect();
    const dialog = image.closest("dialog")!;
    const toolbar = dialog.querySelector(".focus-toolbar")!.getBoundingClientRect();
    const intersect = (other: DOMRect) =>
      Math.max(0, Math.min(rect.right, other.right) - Math.max(rect.left, other.left)) *
      Math.max(0, Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top));
    return {
      ratio: rect.width / rect.height,
      originalRatio: Number(image.getAttribute("width")) / Number(image.getAttribute("height")),
      width: rect.width,
      height: rect.height,
      bounds: [
        rect.left - picture.left,
        picture.right - rect.right,
        rect.top - picture.top,
        picture.bottom - rect.bottom,
        rect.top - toolbar.bottom,
        rect.left,
        innerWidth - rect.right,
        rect.top,
        innerHeight - rect.bottom,
        rect.top - stage.top,
        stage.bottom - rect.bottom
      ],
      controlsOverlap: Array.from(dialog.querySelectorAll(".focus-arrow")).map((arrow) =>
        intersect(arrow.getBoundingClientRect())
      ),
      dialogOverflow: [
        dialog.scrollWidth - dialog.clientWidth,
        dialog.scrollHeight - dialog.clientHeight
      ],
      objectFit: getComputedStyle(image).objectFit,
      placeholder: getComputedStyle(image.parentElement!).backgroundImage
    };
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 568, height: 320 }
]) {
  test(`focus preserves every full photograph from both views at ${viewport.width}×${viewport.height}`, async ({
    page
  }) => {
    await page.setViewportSize(viewport);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto("/playground/photo-gallery/");
      await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
      for (const view of ["Editorial", "Contact sheet"]) {
        await page.getByRole("button", { name: view, exact: true }).click();
        await expect(page.getByRole("button", { name: view, exact: true })).toHaveAttribute(
          "aria-pressed",
          "true"
        );
        const firstPhoto = page.getByRole("button", { name: /^Open photograph 1 of/ });
        await firstPhoto.click();
        for (let index = 1; index <= 16; index++) {
          await expect(page.getByRole("dialog")).toHaveAttribute(
            "aria-label",
            `Photograph ${index} of 16`
          );
          const fit = await photographFit(page);
          const description = `${view}, ${colorScheme}, photograph ${index}`;
          expect(fit.width, description).toBeGreaterThan(0);
          expect(fit.height, description).toBeGreaterThan(0);
          expect(Math.abs(fit.ratio - fit.originalRatio), description).toBeLessThan(0.001);
          expect(Math.min(...fit.bounds), description).toBeGreaterThanOrEqual(-1);
          expect(Math.max(...fit.controlsOverlap), description).toBeLessThanOrEqual(1);
          expect(Math.max(...fit.dialogOverflow), description).toBeLessThanOrEqual(1);
          expect(fit.objectFit).toBe("contain");
          expect(fit.placeholder).toBe("none");
          if (index < 16) await page.keyboard.press("ArrowRight");
        }
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(firstPhoto).toBeFocused();
      }
    }
  });
}

test("portrait focus and metadata adapt to rotation without hiding controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/playground/photo-gallery/?view=contact");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByRole("button", { name: /^Open photograph 4 of/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAttribute("aria-label", "Photograph 4 of 16");
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 568, height: 320 },
    { width: 844, height: 390 }
  ]) {
    await page.setViewportSize(viewport);
    expect(Math.min(...(await photographFit(page)).bounds)).toBeGreaterThanOrEqual(-1);
    const details = page.getByRole("button", { name: "Details", exact: true });
    await details.click();
    await expect(details).toHaveAttribute("aria-expanded", "true");
    const metadata = page.locator(".exif-panel");
    await expect(metadata).toHaveAttribute("aria-label", "Photograph metadata");
    // Native Tab order reaches the scrollable metadata after Close and the two
    // navigation arrows, including engines that do not auto-focus scroll areas.
    for (let index = 0; index < 4; index++) await page.keyboard.press("Tab");
    await expect(metadata).toBeFocused();
    const panel = await metadata.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        height: innerHeight,
        entries: element.querySelectorAll("dd").length,
        scrollable: element.scrollHeight > element.clientHeight + 1
      };
    });
    expect(panel.top).toBeGreaterThanOrEqual(0);
    expect(panel.bottom).toBeLessThanOrEqual(panel.height);
    expect(panel.entries).toBeGreaterThan(0);
    if (viewport.height === 320) expect(panel.scrollable).toBe(true);
    if (panel.scrollable) {
      await page.keyboard.press("End");
      await expect.poll(() => metadata.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(
        await metadata.evaluate(
          (element) =>
            element.lastElementChild!.getBoundingClientRect().bottom <=
            element.getBoundingClientRect().bottom
        )
      ).toBe(true);
    }
    await details.click();
    await expect(page.locator(".exif-panel")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Close focus view" })).toBeVisible();
  }
  await page.getByRole("button", { name: "Next photograph" }).click();
  await expect(dialog).toHaveAttribute("aria-label", "Photograph 5 of 16");
  expect(Math.min(...(await photographFit(page)).bounds)).toBeGreaterThanOrEqual(-1);
  await page.getByRole("button", { name: "Previous photograph" }).click();
  await expect(dialog).toHaveAttribute("aria-label", "Photograph 4 of 16");
  await page.getByRole("button", { name: "Close focus view" }).click();
  await expect(dialog).toHaveCount(0);
});

async function documentGeometry(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const surface = document.querySelector(".site-page")!.getBoundingClientRect();
    const header = document.querySelector(".site-header")!.getBoundingClientRect();
    const toolbar = document.querySelector(".gallery-toolbar")!.getBoundingClientRect();
    return {
      y: scrollY,
      height: root.scrollHeight,
      clientWidth: root.clientWidth,
      surface: [surface.x, surface.width],
      header: [header.x, header.width],
      toolbar: [toolbar.x, toolbar.width],
      overflow: getComputedStyle(root).overflowY,
      gutter: getComputedStyle(root).scrollbarGutter
    };
  });
}

async function expectBackgroundStationary(page: Page, y: number) {
  // Observe the delivered gesture over rendered frames, rather than passing an
  // immediate equality before the browser has had a chance to scroll.
  const positions = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const values: number[] = [];
        const sample = () => {
          values.push(scrollY);
          if (values.length === 16) resolve(values);
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      })
  );
  expect(positions.every((value) => Math.abs(value - y) <= 1)).toBe(true);
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 568, height: 320 }
]) {
  test(`focus locks only background scrolling without a layout shift at ${viewport.width}×${viewport.height}`, async ({
    page
  }) => {
    await page.setViewportSize(viewport);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto("/playground/photo-gallery/?view=contact");
      await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      const photo = page.getByRole("button", { name: /^Open photograph 4 of/ });
      await photo.scrollIntoViewIfNeeded();
      const before = await documentGeometry(page);
      await photo.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toHaveAttribute("aria-label", "Photograph 4 of 16");
      const opened = await documentGeometry(page);
      expect(opened.overflow).toBe("hidden");
      expect(opened.gutter).toBe("stable");
      expect(opened.y).toBe(before.y);
      expect(opened.height).toBe(before.height);
      expect(opened.clientWidth).toBe(before.clientWidth);
      for (const key of ["surface", "header", "toolbar"] as const)
        expect(opened[key]).toEqual(before[key]);
      const fitted = await photographFit(page);
      expect(Math.min(...fitted.bounds)).toBeGreaterThanOrEqual(-1);
      expect(Math.max(...fitted.controlsOverlap)).toBeLessThanOrEqual(1);

      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.mouse.wheel(0, 240);
      await expectBackgroundStationary(page, before.y);
      await page.keyboard.press("PageDown");
      await page.keyboard.press("End");
      await expectBackgroundStationary(page, before.y);

      if (viewport.height === 320) {
        const details = page.getByRole("button", { name: "Details", exact: true });
        await details.click();
        const metadata = page.locator(".exif-panel");
        await metadata.hover();
        await page.mouse.wheel(0, 200);
        await expect
          .poll(() => metadata.evaluate((element) => element.scrollTop))
          .toBeGreaterThan(0);
        await expectBackgroundStationary(page, before.y);
        await details.click();
      }

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(photo).toBeFocused();
      const closed = await documentGeometry(page);
      expect(closed).toEqual(before);
      // Closing restores browser-owned document scrolling immediately.
      await page.keyboard.press("PageDown");
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before.y);
    }
  });
}

test("focus keeps trusted touch gestures inside the modal and restores the page", async ({
  page,
  isMobile
}) => {
  test.skip(!isMobile, "Real touch dispatch is covered by the mobile project.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const session = await page.context().newCDPSession(page);
  try {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 568, height: 320 }
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/playground/photo-gallery/?view=contact");
      await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      const photo = page.getByRole("button", { name: /^Open photograph 4 of/ });
      await photo.scrollIntoViewIfNeeded();
      const before = await documentGeometry(page);
      await photo.click();
      const audit = await page.evaluateHandle(() => {
        const events: { trusted: boolean; prevented: boolean }[] = [];
        window.addEventListener(
          "touchmove",
          (event) => events.push({ trusted: event.isTrusted, prevented: event.defaultPrevented }),
          { passive: true }
        );
        return events;
      });
      const point = (type: "touchStart" | "touchMove" | "touchEnd", y?: number) =>
        session.send("Input.dispatchTouchEvent", {
          type,
          touchPoints: y === undefined ? [] : [{ x: viewport.width / 2, y }]
        });
      await point("touchStart", viewport.height * 0.75);
      await point("touchMove", viewport.height * 0.6);
      await point("touchMove", viewport.height * 0.35);
      await point("touchEnd");
      await expectBackgroundStationary(page, before.y);
      const events = await audit.jsonValue();
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((event) => event.trusted && !event.prevented)).toBe(true);
      await audit.dispose();
      await page.getByRole("button", { name: "Close focus view" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(photo).toBeFocused();
      expect(await documentGeometry(page)).toEqual(before);
    }
  } finally {
    await session.detach();
  }
});
