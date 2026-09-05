import { expect, test, type Page } from "@playwright/test";
import { MAX_WHEEL_IDLE_MS, MIN_WHEEL_IDLE_MS } from "../../src/lib/scroll-boundary";

type Edge = "top" | "bottom";

async function prepare(page: Page, edge: Edge) {
  await page.goto("/cv/");
  await page.evaluate(async (edge) => {
    await document.fonts.ready;
    scrollTo({
      top: edge === "top" ? 0 : document.documentElement.scrollHeight,
      behavior: "instant"
    });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  }, edge);
  await page.mouse.move(30, 500);
}

async function startRecorder(page: Page) {
  return page.evaluateHandle(() => {
    const readOffset = () => {
      const transform = getComputedStyle(
        document.querySelector<HTMLElement>(".site-page")!
      ).transform;
      return transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
    };
    const sample = () => {
      const root = document.documentElement;
      const surface = document.querySelector<HTMLElement>(".site-page")!;
      return {
        time: performance.now(),
        offset: readOffset(),
        y: scrollY,
        height: root.scrollHeight,
        overflow: root.scrollWidth - root.clientWidth,
        state: root.dataset.boundaryState ?? null,
        edge: root.dataset.boundaryFeedback ?? null,
        active: surface.hasAttribute("data-boundary-active"),
        inlineTransform: surface.style.transform
      };
    };
    const frames = [sample()];
    const wheels: Array<{
      time: number;
      delta: number;
      prevented: boolean;
      trusted: boolean;
      state: string | null;
      syncOffset: number;
      microOffset: number;
    }> = [];
    const observe = (event: WheelEvent) => {
      const entry = {
        time: performance.now(),
        delta: event.deltaY,
        prevented: event.defaultPrevented,
        trusted: event.isTrusted,
        state: document.documentElement.dataset.boundaryState ?? null,
        syncOffset: readOffset(),
        microOffset: Number.NaN
      };
      wheels.push(entry);
      queueMicrotask(() => {
        entry.microOffset = readOffset();
      });
    };
    addEventListener("wheel", observe, { passive: true });
    let frameId = 0;
    const frame = () => {
      frames.push(sample());
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    return {
      stop: () => {
        cancelAnimationFrame(frameId);
        removeEventListener("wheel", observe);
        frames.push(sample());
        return { frames, wheels };
      }
    };
  });
}

async function sendProfile(page: Page, deltas: number[], interval: number) {
  // A Playwright wheel command adds roughly 16-45ms of protocol/dispatch time
  // after the page-side timer. Compensate so the measured DOM cadence, rather
  // than the host sleep, is the requested adversarial interval. Center that
  // measured range: subtracting 40ms made fast two-worker dispatches arrive too
  // early. Keep all trajectory and measured-cadence acceptance bounds unchanged.
  const dispatchMargin = Math.min(30, interval / 2);
  for (let index = 0; index < deltas.length; index++) {
    const delivered = page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          addEventListener("wheel", () => resolve(performance.now()), {
            once: true,
            passive: true
          });
        })
    );
    await page.mouse.wheel(0, deltas[index]!);
    const deliveredAt = await delivered;
    if (index < deltas.length - 1) {
      await page.evaluate(
        ({ deliveredAt, interval, dispatchMargin }) =>
          new Promise<void>((resolve) => {
            setTimeout(
              resolve,
              Math.max(0, deliveredAt + interval - dispatchMargin - performance.now())
            );
          }),
        { deliveredAt, interval, dispatchMargin }
      );
    }
  }
}

const signedOffset = (edge: Edge, offset: number) => (edge === "top" ? offset : -offset);

function expectDirectRelease(
  record: {
    frames: Array<{
      time: number;
      offset: number;
      state: string | null;
      active: boolean;
      inlineTransform: string;
    }>;
  },
  edge: Edge,
  after: number
) {
  const releaseFrame = record.frames.find(
    (frame) => frame.time >= after && frame.state === "releasing"
  );
  expect(releaseFrame, `${edge} release frame`).toBeTruthy();
  const settledFrame = record.frames.find(
    (frame) =>
      frame.time >= releaseFrame!.time &&
      !frame.active &&
      Math.abs(frame.offset) <= 0.01 &&
      frame.inlineTransform === ""
  );
  expect(settledFrame, `${edge} settled frame`).toBeTruthy();
  // The configured tween is shorter; this public requirement includes up to
  // two display-frame boundaries around the first/last observable samples.
  expect(settledFrame!.time - releaseFrame!.time, `${edge} release duration`).toBeLessThanOrEqual(
    200
  );

  const positions = record.frames
    .filter((frame) => frame.time >= releaseFrame!.time && frame.time <= settledFrame!.time)
    .map((frame) => signedOffset(edge, frame.offset));
  expect(positions.length, `${edge} release samples`).toBeGreaterThan(2);
  for (let index = 0; index < positions.length; index++) {
    expect(
      positions[index]!,
      `${edge} release crossed zero at sample ${index}`
    ).toBeGreaterThanOrEqual(-0.001);
    if (index > 0)
      expect(positions[index]!, `${edge} release increased at sample ${index}`).toBeLessThanOrEqual(
        positions[index - 1]! + 0.015
      );
  }

  const restingFrames = record.frames.filter((frame) => frame.time >= settledFrame!.time);
  expect(restingFrames.length, `${edge} resting samples`).toBeGreaterThan(1);
  expect(
    restingFrames.every(
      (frame) => Math.abs(frame.offset) <= 0.01 && !frame.active && frame.inlineTransform === ""
    ),
    `${edge} release left residual motion`
  ).toBe(true);
}

test("a full reload preserves repeatable bottom-boundary feedback", async ({ page, isMobile }) => {
  test.skip(isMobile, "The reload audit uses desktop trusted wheel input.");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/research/");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-boundary-feedback-ready", "true");
  await page.evaluate(async () => {
    await document.fonts.ready;
    scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  });
  await page.mouse.move(30, 500);

  const maximum = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let gesture = 0; gesture < 2; gesture++) {
    await page.mouse.wheel(0, 160);
    await expect(page.locator("html")).toHaveAttribute("data-boundary-state", "pulling");
    await expect
      .poll(() =>
        page.locator(".site-page").evaluate((element) => {
          const transform = getComputedStyle(element).transform;
          return transform === "none" ? 0 : -new DOMMatrixReadOnly(transform).m42;
        })
      )
      .toBeGreaterThan(5);
    await expect
      .poll(() =>
        page.locator(".site-page").evaluate((element) => {
          const transform = getComputedStyle(element).transform;
          return transform === "none" ? 0 : Math.abs(new DOMMatrixReadOnly(transform).m42);
        })
      )
      .toBeLessThanOrEqual(0.1);
    await expect(page.locator(".site-page")).not.toHaveAttribute("data-boundary-active", "");
    expect(await page.evaluate(() => scrollY)).toBeCloseTo(maximum, 0);
  }
});

for (const interval of [80, 90, 100, 130]) {
  test(`continuous ${interval}ms boundary input never sawtooths and releases promptly`, async ({
    page,
    isMobile
  }, testInfo) => {
    test.skip(isMobile, "The trajectory audit uses desktop trusted wheel input.");
    test.setTimeout(45_000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 1366, height: 900 });

    for (const edge of ["top", "bottom"] as const) {
      await prepare(page, edge);
      const rounds = interval === 100 ? 2 : 1;
      for (let round = 0; round < rounds; round++) {
        const recorder = await startRecorder(page);
        try {
          await sendProfile(page, Array<number>(24).fill((edge === "top" ? -1 : 1) * 15), interval);
          await page.waitForTimeout(480);
          const record = await recorder.evaluate((value) => value.stop());
          await testInfo.attach(`${edge}-${interval}ms-round-${round + 1}`, {
            body: JSON.stringify(record),
            contentType: "application/json"
          });

          expect(record.wheels).toHaveLength(24);
          expect(record.wheels.every((event) => event.trusted && event.prevented)).toBe(true);
          expect(record.wheels.every((event) => event.state === "pulling")).toBe(true);
          expect(
            record.wheels.every((event) => Math.abs(event.microOffset - event.syncOffset) <= 0.05)
          ).toBe(true);
          const cadence = record.wheels
            .slice(1)
            .map((event, index) => event.time - record.wheels[index]!.time);
          expect(Math.min(...cadence)).toBeGreaterThanOrEqual(interval - 22);
          const sortedCadence = cadence.toSorted((left, right) => left - right);
          expect(sortedCadence[Math.floor(sortedCadence.length / 2)]).toBeLessThanOrEqual(
            interval + 22
          );
          expect(Math.max(...cadence)).toBeLessThan(MAX_WHEEL_IDLE_MS - 3);

          const lastInput = record.wheels.at(-1)!.time;
          const activeFrames = record.frames.filter(
            (frame) => frame.time <= lastInput + MIN_WHEEL_IDLE_MS - 8
          );
          const positions = activeFrames.map((frame) => signedOffset(edge, frame.offset));
          const firstVisible = positions.findIndex((position) => position > 0.2);
          expect(firstVisible).toBeGreaterThanOrEqual(0);
          const reversals = positions
            .slice(firstVisible + 1)
            .filter((position, index) => position < positions[firstVisible + index]! - 0.12);
          expect(reversals, `${edge} ${interval}ms round ${round + 1}`).toHaveLength(0);
          expect(Math.max(...positions)).toBeGreaterThan(35);
          expect(Math.max(...positions)).toBeLessThan(56);

          const releaseFrame = record.frames.find(
            (frame) => frame.time >= lastInput && frame.state === "releasing"
          );
          expect(releaseFrame).toBeTruthy();
          expect(releaseFrame!.time - lastInput).toBeGreaterThanOrEqual(MIN_WHEEL_IDLE_MS - 18);
          expect(releaseFrame!.time - lastInput).toBeLessThanOrEqual(MAX_WHEEL_IDLE_MS + 55);
          const settledFrame = record.frames.find(
            (frame) => frame.time >= lastInput && !frame.active && frame.inlineTransform === ""
          );
          expect(settledFrame).toBeTruthy();
          expect(settledFrame!.time - lastInput).toBeLessThanOrEqual(430);
          expectDirectRelease(record, edge, lastInput);

          const returnPositions = record.frames
            .filter((frame) => frame.time >= lastInput)
            .map((frame) => signedOffset(edge, frame.offset));
          const peakIndex = returnPositions.indexOf(Math.max(...returnPositions));
          const secondOutwardTurns = returnPositions
            .slice(peakIndex + 1)
            .filter((position, index) => position > returnPositions[peakIndex + index]! + 0.15);
          expect(secondOutwardTurns).toHaveLength(0);

          const initial = record.frames[0]!;
          expect(new Set(record.frames.map((frame) => frame.height))).toEqual(
            new Set([initial.height])
          );
          expect(Math.max(...record.frames.map((frame) => frame.overflow))).toBeLessThanOrEqual(1);
          expect(
            Math.max(...record.frames.map((frame) => Math.abs(frame.y - initial.y)))
          ).toBeLessThanOrEqual(1);
        } finally {
          await recorder.dispose();
        }
      }
    }
  });
}

test("declining and sparse wheel tails release once without a second peak", async ({
  page,
  isMobile
}, testInfo) => {
  test.skip(isMobile, "The tail audit uses desktop trusted wheel input.");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1366, height: 900 });
  await prepare(page, "bottom");

  let recorder = await startRecorder(page);
  await sendProfile(page, [40, 38, 36.1, 36.4, 34.3, 32.6, 31, 29.4, 28, 26.6, 25.3, 24], 16);
  await page.waitForTimeout(420);
  let record = await recorder.evaluate((value) => value.stop());
  await recorder.dispose();
  await testInfo.attach("five-percent-declining-tail", {
    body: JSON.stringify(record),
    contentType: "application/json"
  });
  const positions = record.frames.map((frame) => -frame.offset);
  const peakIndex = positions.indexOf(Math.max(...positions));
  expect(
    positions
      .slice(peakIndex + 1)
      .filter((position, index) => position > positions[peakIndex + index]! + 0.15)
  ).toHaveLength(0);
  expect(record.wheels.some((event) => event.state === "releasing")).toBe(true);
  expect(record.frames.at(-1)!.active).toBe(false);
  expectDirectRelease(record, "bottom", record.wheels[0]!.time);

  await page.mouse.wheel(0, 18);
  await expect(page.locator("html")).toHaveAttribute("data-boundary-state", "pulling");
  await expect
    .poll(
      async () =>
        -(await page.locator(".site-page").evaluate((element) => {
          const transform = getComputedStyle(element).transform;
          return transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
        }))
    )
    .toBeGreaterThan(1);
  await expect
    .poll(() =>
      page.locator(".site-page").evaluate((element) => {
        const transform = getComputedStyle(element).transform;
        return transform === "none" ? 0 : Math.abs(new DOMMatrixReadOnly(transform).m42);
      })
    )
    .toBeLessThanOrEqual(0.1);

  await prepare(page, "bottom");
  recorder = await startRecorder(page);
  await sendProfile(page, [20, 19.6, 19.2, 18.8, 18.4, 18, 17.6, 17.2, 16.8, 16.4, 16], 150);
  await page.waitForTimeout(420);
  record = await recorder.evaluate((value) => value.stop());
  await recorder.dispose();
  await testInfo.attach("sparse-tail", {
    body: JSON.stringify(record),
    contentType: "application/json"
  });
  const sparsePositions = record.frames.map((frame) => -frame.offset);
  const sparsePeak = sparsePositions.indexOf(Math.max(...sparsePositions));
  expect(
    sparsePositions
      .slice(sparsePeak + 1)
      .filter((position, index) => position > sparsePositions[sparsePeak + index]! + 0.15)
  ).toHaveLength(0);
  expect(record.wheels.some((event) => event.state === "releasing")).toBe(true);
  expect(record.frames.at(-1)!.active).toBe(false);
  expectDirectRelease(record, "bottom", record.wheels[0]!.time);
});

test("noisy same-direction momentum cannot recapture a releasing page", async ({
  page,
  isMobile
}) => {
  test.skip(isMobile, "The noisy-tail audit uses desktop trusted wheel input.");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1366, height: 900 });
  await prepare(page, "bottom");
  const recorder = await startRecorder(page);
  try {
    await sendProfile(page, [52, 43, 34, 25, 17, 12, 7, 10, 5, 8, 3], 16);
    await page.waitForTimeout(360);
    const record = await recorder.evaluate((value) => value.stop());
    const releaseIndex = record.frames.findIndex((frame) => frame.state === "releasing");
    expect(releaseIndex).toBeGreaterThanOrEqual(0);
    expect(record.frames.slice(releaseIndex).some((frame) => frame.state === "pulling")).toBe(
      false
    );
    expect(
      record.wheels.slice(4).every((event) => event.state === "releasing" || event.state === null)
    ).toBe(true);
    expectDirectRelease(record, "bottom", record.wheels[3]!.time);
  } finally {
    await recorder.dispose();
  }
});

test("reverse input consumes the stretch before native scrolling resumes", async ({
  page,
  isMobile
}) => {
  test.skip(isMobile, "The reversal audit uses desktop trusted wheel input.");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1366, height: 900 });
  await prepare(page, "bottom");
  const maximum = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  await page.mouse.wheel(0, 180);
  await page.waitForTimeout(80);
  const pulled = await page.locator(".site-page").evaluate((element) => {
    const transform = getComputedStyle(element).transform;
    return transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
  });
  expect(pulled).toBeLessThan(-10);

  await page.mouse.wheel(0, -12);
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(maximum, 0);
  await expect
    .poll(() =>
      page.locator(".site-page").evaluate((element) => {
        const transform = getComputedStyle(element).transform;
        return transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
      })
    )
    .toBeGreaterThan(pulled);

  await page.mouse.wheel(0, -500);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(maximum - 100);
  await expect(page.locator(".site-page")).not.toHaveAttribute("data-boundary-active", "");
  const interiorY = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 40);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(interiorY);
  expect(await page.locator("html").getAttribute("data-boundary-state")).not.toBe("pulling");
});

test("reverse input during release immediately returns ownership without a rebound", async ({
  page,
  isMobile
}) => {
  test.skip(isMobile, "The partial-reversal audit uses desktop trusted wheel input.");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1366, height: 900 });
  await prepare(page, "bottom");
  const maximum = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const recorder = await startRecorder(page);
  try {
    await page.mouse.wheel(0, 500);
    await expect(page.locator("html")).toHaveAttribute("data-boundary-state", "releasing");
    await page.mouse.wheel(0, -8);
    await page.waitForTimeout(260);
    const record = await recorder.evaluate((value) => value.stop());
    expect(record.wheels).toHaveLength(2);
    expect(record.wheels[1]).toMatchObject({
      trusted: true,
      prevented: true,
      state: null
    });
    const after = record.frames.filter((frame) => frame.time >= record.wheels[1]!.time);
    expect(after.every((frame) => Math.abs(frame.offset) <= 0.01 && !frame.active)).toBe(true);
    expect(await page.evaluate(() => scrollY)).toBeCloseTo(maximum - 8, 0);
  } finally {
    await recorder.dispose();
  }
});

test("strong outward input caught during release restarts without one inward frame", async ({
  page,
  isMobile
}) => {
  test.skip(isMobile, "The release-catch audit uses desktop trusted wheel input.");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1366, height: 900 });
  await prepare(page, "bottom");
  await page.mouse.wheel(0, 120);
  await expect(page.locator("html")).toHaveAttribute("data-boundary-state", "releasing");
  await page.waitForTimeout(30);
  const recorder = await startRecorder(page);
  try {
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(120);
    const record = await recorder.evaluate((value) => value.stop());
    const positions = record.frames
      .filter((frame) => frame.time >= record.wheels[0]!.time)
      .map((frame) => -frame.offset);
    const firstVisible = positions.findIndex((position) => position > 0.1);
    expect(firstVisible).toBeGreaterThanOrEqual(0);
    expect(
      positions
        .slice(firstVisible + 1)
        .filter((position, index) => position < positions[firstVisible + index]! - 0.12)
    ).toHaveLength(0);
    expect(record.wheels).toHaveLength(1);
    expect(record.wheels[0]).toMatchObject({ trusted: true, prevented: true, state: "pulling" });
  } finally {
    await recorder.dispose();
  }
});

test("exposed top and bottom canvas matches the site bars in both themes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });
  await page.goto("/research/");
  for (const theme of ["light", "dark"] as const) {
    if (theme === "dark") {
      const toggle = page.getByRole("button", { name: "Switch color theme" });
      if (!(await toggle.isVisible()))
        await page.getByRole("button", { name: "Open navigation" }).click();
      await toggle.click();
    }
    const colors = await page.evaluate(() => {
      const color = (selector: string) =>
        getComputedStyle(document.querySelector<HTMLElement>(selector)!).backgroundColor;
      return {
        root: color("html"),
        body: color("body"),
        clip: color(".site-page-clip"),
        surface: color(".site-page"),
        header: color(".site-header"),
        footer: color(".site-footer")
      };
    });
    expect(colors.root).toBe(colors.header);
    expect(colors.body).toBe(colors.header);
    expect(colors.clip).toBe(colors.header);
    expect(colors.footer).toBe(colors.header);
    expect(colors.surface).not.toBe(colors.header);
    await expect(page.locator(".site-page-clip")).toHaveCSS("overflow", "clip");
    await expect(page.locator(".site-page")).toHaveCSS("will-change", "auto");
    await expect(page.locator("html")).toHaveCSS("overscroll-behavior-y", "none");
  }
});
