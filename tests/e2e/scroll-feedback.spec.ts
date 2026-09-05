import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page, path = "/teaching/") {
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("data-boundary-feedback-ready", "true");
  await page.evaluate(() => document.fonts.ready);
}

async function settleScroll(page: Page, edge: "top" | "bottom") {
  await page.evaluate(async (edge) => {
    scrollTo({
      top: edge === "top" ? 0 : document.documentElement.scrollHeight,
      behavior: "instant"
    });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  }, edge);
}

const state = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    const surface = document.querySelector<HTMLElement>(".site-page")!;
    return {
      offset: new DOMMatrixReadOnly(getComputedStyle(surface).transform).m42,
      y: scrollY,
      height: root.scrollHeight,
      maximum: root.scrollHeight - innerHeight,
      overflow: root.scrollWidth - root.clientWidth,
      phase: root.dataset.boundaryState ?? "idle",
      edge: root.dataset.boundaryFeedback ?? "",
      active: surface.hasAttribute("data-boundary-active"),
      headerTop: document.querySelector(".site-header")!.getBoundingClientRect().top
    };
  });

async function expectSettled(page: Page) {
  await expect.poll(async () => Math.abs((await state(page)).offset)).toBeLessThanOrEqual(0.1);
  await expect(page.locator("html")).not.toHaveAttribute("data-boundary-feedback");
  await expect(page.locator("html")).not.toHaveAttribute("data-boundary-state");
  await expect(page.locator(".site-page")).not.toHaveAttribute("data-boundary-active");
  await expect(page.locator(".site-page")).toHaveCSS("transform", "none");
  await expect(page.locator(".site-page")).toHaveCSS("will-change", "auto");
}

async function wheelEvent(page: Page, deltaX: number, deltaY: number) {
  const delivered = page.evaluate(
    () =>
      new Promise<{
        cancelable: boolean;
        prevented: boolean;
        trusted: boolean;
        deltaX: number;
        deltaY: number;
      }>((resolve) => {
        window.addEventListener(
          "wheel",
          (event) =>
            resolve({
              cancelable: event.cancelable,
              prevented: event.defaultPrevented,
              trusted: event.isTrusted,
              deltaX: event.deltaX,
              deltaY: event.deltaY
            }),
          { once: true }
        );
      })
  );
  await page.mouse.wheel(deltaX, deltaY);
  return delivered;
}

test("all routes preserve native document range, document-end footers and stable width", async ({
  page
}) => {
  const routes = [
    "/",
    "/cv/",
    "/research/",
    "/teaching/",
    "/playground/photo-gallery/",
    "/playground/hugo-le-chatssius/",
    "/playground/thales-olive/",
    "/404.html",
    "/archive/hugo-uw-profile/"
  ];
  await page.setViewportSize({ width: 1440, height: 1800 });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const route of routes) {
      await page.goto(route);
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => ({
        range: document.documentElement.scrollHeight - innerHeight,
        footerEnd:
          document.querySelector(".site-footer, body > footer")!.getBoundingClientRect().bottom +
          scrollY,
        height: document.documentElement.scrollHeight,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      }));
      expect(layout.range, route).toBeGreaterThanOrEqual(27);
      expect(Math.abs(layout.footerEnd - layout.height), route).toBeLessThanOrEqual(1);
      expect(layout.overflow, route).toBeLessThanOrEqual(1);
      if (!route.startsWith("/archive/")) {
        await expect(page.locator("html")).toHaveAttribute("data-boundary-feedback-ready", "true");
        await expect(page.locator("html")).not.toHaveAttribute("data-boundary-enhanced");
        await expectSettled(page);
      }
    }
  }
});

test("interior wheel stays native; only an outward boundary wheel is custom", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page, "/cv/");
  await page.evaluate(() => scrollTo({ top: 200, behavior: "instant" }));
  const interiorStart = await state(page);
  await page.mouse.move(30, 500);
  const interior = await wheelEvent(page, 0, 180);
  expect(interior).toMatchObject({ prevented: false, trusted: true });
  await expect.poll(async () => (await state(page)).y).toBeGreaterThan(interiorStart.y);
  const interiorEnd = await state(page);
  expect(interiorEnd.offset).toBe(0);
  expect(interiorEnd.active).toBe(false);
  expect(interiorEnd.height).toBe(interiorStart.height);
  expect(interiorEnd.overflow).toBeLessThanOrEqual(1);
  expect(interiorEnd.headerTop).toBeCloseTo(0, 1);

  await settleScroll(page, "bottom");
  const boundaryStart = await state(page);
  const outward = await wheelEvent(page, 0, 100);
  expect(outward).toMatchObject({ cancelable: true, prevented: true, trusted: true });
  await expect.poll(async () => Math.abs((await state(page)).offset)).toBeGreaterThan(1);
  const pulled = await state(page);
  expect(pulled.phase).toBe("pulling");
  expect(pulled.edge).toBe("bottom");
  expect(pulled.active).toBe(true);
  expect(pulled.y).toBe(boundaryStart.y);
  expect(pulled.height).toBe(boundaryStart.height);
  expect(pulled.overflow).toBeLessThanOrEqual(1);
  expect(pulled.headerTop).toBeCloseTo(pulled.offset, 1);
  await expectSettled(page);
  expect((await state(page)).height).toBe(boundaryStart.height);
});

test("sticky navigation, keyboard, focus and anchors remain native", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page, "/cv/");
  await page.mouse.move(30, 500);
  await page.mouse.wheel(0, 250);
  await expect.poll(async () => (await state(page)).y).toBeGreaterThan(100);
  expect((await state(page)).headerTop).toBeCloseTo(0, 1);
  expect((await state(page)).offset).toBe(0);
  await page.keyboard.press("End");
  await expect
    .poll(async () => {
      const current = await state(page);
      return current.maximum - current.y;
    })
    .toBeLessThanOrEqual(1);
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => Math.abs((await state(page)).offset)).toBeGreaterThan(1);
  await page.keyboard.press("Home");
  await expect.poll(async () => (await state(page)).y).toBe(0);
  await expectSettled(page);
  await page.locator(".skip-link").focus();
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.querySelector("main")!.contains(document.activeElement))
  ).toBe(true);
  await expectSettled(page);
});

test("reduced motion, zoom and modified or horizontal wheel input never stretch the page", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ready(page, "/cv/");
  await settleScroll(page, "bottom");
  await page.mouse.move(30, 500);
  const reduced = await wheelEvent(page, 0, 100);
  expect(reduced.prevented).toBe(false);
  await expect(page.locator("html")).not.toHaveAttribute("data-boundary-enhanced");
  await expect(page.locator("html")).toHaveCSS("overscroll-behavior-y", "auto");
  await expectSettled(page);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("html")).toHaveAttribute("data-boundary-enhanced");
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    await expect.poll(() => page.evaluate(() => visualViewport?.scale)).toBe(2);
    const zoomed = await wheelEvent(page, 0, 100);
    expect(zoomed.prevented).toBe(false);
    await expect(page.locator("html")).not.toHaveAttribute("data-boundary-enhanced");
    await expectSettled(page);
    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await expect.poll(() => page.evaluate(() => visualViewport?.scale)).toBe(1);
  } finally {
    await session.detach();
  }
  await expect(page.locator("html")).toHaveAttribute("data-boundary-enhanced");

  for (const key of ["Control", "Meta", "Shift"] as const) {
    await page.keyboard.down(key);
    const modified = await wheelEvent(page, 0, 100);
    await page.keyboard.up(key);
    expect(modified.prevented, key).toBe(false);
    await expectSettled(page);
  }
  const horizontal = await wheelEvent(page, 180, 0);
  expect(horizontal.prevented).toBe(false);
  await expectSettled(page);
});

test("Olive horizontal charts, Gallery dialogs and Playground popovers keep ownership", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, "/playground/thales-olive/");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  const chart = page.getByRole("region", { name: "Scrollable business revenue chart" });
  await chart.scrollIntoViewIfNeeded();
  const pageY = await page.evaluate(() => scrollY);
  await chart.hover();
  const chartWheel = await wheelEvent(page, 300, 0);
  expect(chartWheel.prevented).toBe(false);
  await expect.poll(() => chart.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(pageY);
  await expectSettled(page);

  await ready(page, "/playground/photo-gallery/");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  const firstPhoto = page.getByRole("button", { name: /^Open photograph/ }).first();
  await firstPhoto.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const modalY = await page.evaluate(() => scrollY);
  await page.mouse.move(30, 500);
  const modalWheel = await wheelEvent(page, 0, -250);
  expect(modalWheel.prevented).toBe(false);
  expect(await page.evaluate(() => scrollY)).toBe(modalY);
  await expectSettled(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(firstPhoto).toBeFocused();

  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page);
  const trigger = page.getByRole("button", { name: "Playground", exact: true });
  if (!(await trigger.isVisible()))
    await page.getByRole("button", { name: "Open navigation" }).click();
  await trigger.click();
  await expect(page.locator(".playground-menu")).toBeVisible();
  await settleScroll(page, "top");
  const popoverWheel = await wheelEvent(page, 0, -120);
  expect(popoverWheel.prevented).toBe(false);
  await expectSettled(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".playground-menu")).not.toBeVisible();
});

test("nested vertical scroll regions and text controls remain native at a page boundary", async ({
  page
}) => {
  await ready(page);
  await page.evaluate(() => {
    const nested = document.createElement("div");
    nested.tabIndex = 0;
    nested.setAttribute("role", "region");
    nested.setAttribute("aria-label", "Nested scroll fixture");
    nested.style.cssText = "height:100px;width:220px;overflow:auto;background:white;color:black";
    const content = document.createElement("div");
    content.style.height = "500px";
    content.textContent = "Nested scrolling regression fixture";
    nested.appendChild(content);
    const textarea = document.createElement("textarea");
    textarea.setAttribute("aria-label", "Native text fixture");
    textarea.value = Array.from({ length: 60 }, (_, index) => `Line ${index + 1}`).join("\n");
    textarea.style.cssText = "display:block;width:220px;height:100px";
    const footer = document.querySelector<HTMLElement>(".site-footer")!;
    footer.appendChild(nested);
    footer.appendChild(textarea);
  });
  await settleScroll(page, "bottom");
  for (const control of [
    page.getByRole("region", { name: "Nested scroll fixture" }),
    page.getByRole("textbox", { name: "Native text fixture" })
  ]) {
    await control.scrollIntoViewIfNeeded();
    const beforeY = await page.evaluate(() => scrollY);
    await control.hover();
    const owned = await wheelEvent(page, 0, 80);
    expect(owned.prevented).toBe(false);
    await expect.poll(() => control.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => scrollY)).toBe(beforeY);
    await expectSettled(page);
  }
  const textarea = page.getByRole("textbox", { name: "Native text fixture" });
  await textarea.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await expect(textarea).toBeFocused();
  expect(
    await textarea.evaluate((element) => (element as HTMLTextAreaElement).selectionStart)
  ).toBe((await textarea.inputValue()).length);
});

test("trusted boundary touch pulls, holds, releases on end and cancel", async ({
  page,
  isMobile
}) => {
  test.skip(!isMobile, "Trusted touch input is exercised by the mobile project.");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, "/cv/");
  const session = await page.context().newCDPSession(page);
  const point = (type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel", y?: number) =>
    session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: y === undefined ? [] : [{ x: 30, y }]
    });
  try {
    await settleScroll(page, "bottom");
    const initial = await state(page);
    await point("touchStart", 600);
    await point("touchMove", 540);
    await expect.poll(async () => (await state(page)).offset).toBeLessThan(-1);
    await page.waitForTimeout(250);
    const held = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const values: number[] = [];
          const started = performance.now();
          const frame = () => {
            values.push(
              new DOMMatrixReadOnly(
                getComputedStyle(document.querySelector(".site-page")!).transform
              ).m42
            );
            if (performance.now() - started >= 1000) resolve(values);
            else requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        })
    );
    expect(Math.max(...held) - Math.min(...held)).toBeLessThan(0.2);
    expect(Math.max(...held)).toBeLessThan(-1);
    expect((await state(page)).y).toBe(initial.y);
    expect((await state(page)).height).toBe(initial.height);
    await point("touchEnd");
    await expectSettled(page);

    await settleScroll(page, "top");
    await point("touchStart", 300);
    await point("touchMove", 420);
    await expect.poll(async () => (await state(page)).offset).toBeGreaterThan(1);
    await point("touchCancel");
    await expectSettled(page);

    await settleScroll(page, "bottom");
    await point("touchStart", 600);
    await point("touchMove", 540);
    await expect.poll(async () => (await state(page)).offset).toBeLessThan(-1);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expectSettled(page);
    await point("touchMove", 500);
    expect(Math.abs((await state(page)).offset)).toBeLessThanOrEqual(0.1);
    await point("touchEnd");

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await settleScroll(page, "bottom");
    await point("touchStart", 600);
    await point("touchMove", 540);
    await expect.poll(async () => (await state(page)).offset).toBeLessThan(-1);
    await page.evaluate(() => document.querySelector<HTMLElement>("a")!.focus());
    await expectSettled(page);
    await point("touchMove", 500);
    expect(Math.abs((await state(page)).offset)).toBeLessThanOrEqual(0.1);
    await point("touchEnd");
    expect((await state(page)).height).toBe(initial.height);
    expect((await state(page)).overflow).toBeLessThanOrEqual(1);
  } finally {
    await session.detach();
  }
});

test("a captured touch reverses through zero and keeps scrolling until it ends", async ({
  page,
  isMobile
}) => {
  test.skip(!isMobile, "Trusted touch input is exercised by the mobile project.");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, "/cv/");
  await settleScroll(page, "bottom");
  const maximum = (await state(page)).maximum;
  const session = await page.context().newCDPSession(page);
  const point = (type: "touchStart" | "touchMove" | "touchEnd", y?: number) =>
    session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: y === undefined ? [] : [{ x: 30, y }]
    });
  try {
    await point("touchStart", 500);
    await point("touchMove", 420);
    await expect.poll(async () => (await state(page)).offset).toBeLessThan(-1);

    await point("touchMove", 560);
    await expect.poll(async () => (await state(page)).y).toBeLessThan(maximum - 20);
    const crossed = await state(page);
    expect(Math.abs(crossed.offset)).toBeLessThanOrEqual(0.1);
    expect(crossed.active).toBe(false);

    await point("touchMove", 620);
    await expect.poll(async () => (await state(page)).y).toBeLessThan(crossed.y - 40);
    const continued = await state(page);
    await point("touchMove", 680);
    await expect.poll(async () => (await state(page)).y).toBeLessThan(continued.y - 40);
    expect(Math.abs((await state(page)).offset)).toBeLessThanOrEqual(0.1);
    await point("touchEnd");
    await expectSettled(page);
  } finally {
    await session.detach();
  }
});

test("a trusted non-cancelable native-owned touch sequence fails closed", async ({
  page,
  isMobile
}) => {
  test.skip(!isMobile, "Trusted touch input is exercised by the mobile project.");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, "/cv/");
  await page.evaluate(() =>
    scrollTo({
      top: document.documentElement.scrollHeight - innerHeight - 130,
      behavior: "instant"
    })
  );
  const initial = await state(page);
  const events = await page.evaluateHandle(() => {
    const records: { cancelable: boolean; prevented: boolean; trusted: boolean }[] = [];
    window.addEventListener(
      "touchmove",
      (event) =>
        queueMicrotask(() =>
          records.push({
            cancelable: event.cancelable,
            prevented: event.defaultPrevented,
            trusted: event.isTrusted
          })
        ),
      { passive: true }
    );
    return records;
  });
  const session = await page.context().newCDPSession(page);
  const point = (type: "touchStart" | "touchMove" | "touchEnd", y?: number) =>
    session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: y === undefined ? [] : [{ x: 30, y }]
    });
  try {
    await point("touchStart", 600);
    await point("touchMove", 560);
    await expect.poll(async () => (await state(page)).y).toBeGreaterThan(initial.y);
    await point("touchMove", 380);
    await expect
      .poll(async () => {
        const current = await state(page);
        return current.maximum - current.y;
      })
      .toBeLessThanOrEqual(1);
    await point("touchMove", 330);
    await point("touchMove", 390);
    await expect.poll(async () => (await state(page)).y).toBeLessThan(initial.maximum);
    await point("touchEnd");
    await expectSettled(page);
    const observed = await events.jsonValue();
    expect(observed.length).toBeGreaterThanOrEqual(4);
    expect(observed.every((event) => event.trusted && !event.prevented)).toBe(true);
    expect(observed.some((event) => !event.cancelable)).toBe(true);
  } finally {
    await events.dispose();
    await session.detach();
  }
});

test("without JavaScript the page keeps native scrolling and overscroll defaults", async ({
  browser
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 1800 }
  });
  try {
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:8787/teaching/");
    await expect(page.locator("html")).not.toHaveAttribute("data-boundary-feedback-ready");
    await expect(page.locator("html")).not.toHaveAttribute("data-boundary-enhanced");
    await expect(page.locator("html")).toHaveCSS("overscroll-behavior-y", "auto");
    await expect(page.locator(".site-page")).toHaveCSS("transform", "none");
    await page.keyboard.press("End");
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThanOrEqual(27);
    expect(
      await page.evaluate(
        () =>
          document.querySelector(".site-footer")!.getBoundingClientRect().bottom +
          scrollY -
          document.documentElement.scrollHeight
      )
    ).toBeCloseTo(0, 0);
  } finally {
    await context.close();
  }
});

test("requested labels remain clean and the archive remains script-free", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".home-interests")).toHaveText(
    "Political Theory, Gender Equality, Digital Space"
  );
  await page.goto("/playground/thales-olive/");
  await expect(page.locator(".quote-heading .eyebrow")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Can PhDs Be Rich?" })).toBeVisible();
  await page.goto("/archive/hugo-uw-profile/");
  await expect(page.locator("script")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-boundary-feedback-ready");
  await expect(page.locator("html")).not.toHaveAttribute("data-boundary-enhanced");
});
