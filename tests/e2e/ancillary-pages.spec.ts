import { expect, test } from "@playwright/test";

test("page footers end the document, including shorter pages", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1200 });
    for (const route of ["/", "/teaching/", "/research/", "/cv/"]) {
      await page.goto(route);
      const dimensions = await page.locator(".site-footer").evaluate((footer) => ({
        bottom: footer.getBoundingClientRect().bottom + window.scrollY,
        documentHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        position: getComputedStyle(footer).position
      }));
      expect(dimensions.bottom).toBeGreaterThanOrEqual(dimensions.viewportHeight - 1);
      expect(Math.abs(dimensions.bottom - dimensions.documentHeight)).toBeLessThanOrEqual(1);
      expect(dimensions.position).not.toBe("fixed");
    }
  }
});

test("sparse Home and Research pages keep an intrinsic footer", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1200 });
      for (const route of ["/", "/research/"]) {
        await page.goto(route);
        await page.evaluate(() => document.fonts.ready);
        const layout = await page.evaluate(() => {
          const main = document.querySelector<HTMLElement>(".site-page > main")!;
          const footer = document.querySelector<HTMLElement>(".site-footer")!;
          const footerBox = footer.getBoundingClientRect();
          return {
            mainFlexGrow: getComputedStyle(main).flexGrow,
            footerFlexGrow: getComputedStyle(footer).flexGrow,
            footerHeight: footerBox.height,
            footerColor: getComputedStyle(footer).backgroundColor,
            rootColor: getComputedStyle(document.documentElement).backgroundColor,
            range: document.documentElement.scrollHeight - innerHeight,
            footerEnd: footerBox.bottom + scrollY,
            documentHeight: document.documentElement.scrollHeight
          };
        });
        expect(layout.mainFlexGrow).toBe("1");
        expect(layout.footerFlexGrow).toBe("0");
        expect(layout.footerHeight).toBeGreaterThanOrEqual(112);
        expect(layout.footerHeight).toBeLessThan(200);
        expect(layout.footerColor).toBe(layout.rootColor);
        expect(layout.range).toBeGreaterThanOrEqual(27);
        expect(Math.abs(layout.footerEnd - layout.documentHeight)).toBeLessThanOrEqual(1);
      }
    }
  }
});

test("Home paper stays straight and the wordmark uses one responsive font size", async ({
  page
}) => {
  for (const width of [320, 390, 840, 841, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(page.locator(".portrait-wrap .portrait-frame")).toHaveCSS("transform", "none");
    const fontSizes = await page.locator(".wordmark").evaluate((wordmark) => ({
      name: getComputedStyle(wordmark).fontSize,
      discipline: getComputedStyle(wordmark.querySelector(".wordmark-discipline")!).fontSize
    }));
    expect(fontSizes.discipline).toBe(fontSizes.name);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      )
    ).toBe(true);
  }
});

test("research separators follow each item", async ({ page }) => {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/research/");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Research");
    await expect(page.getByRole("heading", { name: "Ideas in progress." })).toHaveCount(0);
    await expect(
      page.getByText(
        "My work connects feminist political theory with empirical questions about gender and political life in digital space."
      )
    ).toHaveCount(0);
    const divider = await page.locator(".section-block").evaluate((section) => {
      const heading = document.querySelector(".page-intro h1")!.getBoundingClientRect();
      const status = document.querySelector(".research-card .status-row")!.getBoundingClientRect();
      const sectionBox = section.getBoundingClientRect();
      const style = getComputedStyle(section);
      return {
        style: style.borderTopStyle,
        width: style.borderTopWidth,
        color: style.borderTopColor,
        top: sectionBox.top,
        headingBottom: heading.bottom,
        statusTop: status.top,
        headingToStatus: status.top - heading.bottom
      };
    });
    expect(divider.style).toBe("dashed");
    expect(divider.width).toBe("1px");
    expect(divider.color).not.toBe("rgba(0, 0, 0, 0)");
    expect(divider.top).toBeGreaterThan(divider.headingBottom);
    expect(divider.top).toBeLessThan(divider.statusTop);
    expect(divider.headingToStatus).toBeLessThanOrEqual(56);

    const separators = await page.locator(".research-card").evaluateAll((cards) =>
      cards.map((card) => ({
        top: getComputedStyle(card).borderTopWidth,
        bottom: getComputedStyle(card).borderBottomWidth
      }))
    );
    expect(separators.length).toBeGreaterThan(0);
    for (const separator of separators) {
      expect(separator).toEqual({ top: "0px", bottom: "1px" });
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      )
    ).toBe(true);
  }
});

test("the historical UW profile is complete and loads without external dependencies", async ({
  page
}) => {
  const remoteRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(requestUrl.hostname)) {
      remoteRequests.push(requestUrl.href);
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await page.goto("/playground/hugo-le-chatssius/");
  await page.getByRole("link", { name: "Historical UW Profile", exact: true }).click();
  await expect(page).toHaveURL(/\/archive\/hugo-uw-profile\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hugo zzee Mascot");
  await expect(page.getByText("Political Science Mascot 2025-2026", { exact: true })).toBeVisible();
  await expect(page.locator(".archive-notice")).toContainText("not a live UW page");
  await expect(page.locator(".field-name-field-biography")).toContainText(
    "vigilant sunbeam surveillance."
  );
  const image = page.getByRole("img", { name: "Hugo", exact: true });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBe(200);
  await expect(page.locator(".institution-header")).toHaveCSS(
    "background-color",
    "rgb(75, 46, 131)"
  );
  await expect(page.locator("script, iframe, form, object, embed")).toHaveCount(0);
  expect(remoteRequests).toEqual([]);
  const provenanceLink = page.getByRole("link", { name: "Archive source and integrity details" });
  const provenance = await page.request.get(
    await provenanceLink.getAttribute("href").then((href) => new URL(href!, page.url()).href)
  );
  expect(provenance.ok()).toBe(true);
  expect(await provenance.json()).toMatchObject({
    title: "Hugo zzee Mascot",
    capturedAt: "2026-09-02T05:41:46Z"
  });
  await page.getByRole("link", { name: "Return to Hugo" }).click();
  await expect(page).toHaveURL(/\/playground\/hugo-le-chatssius\/$/);
});
