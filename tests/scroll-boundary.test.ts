import { describe, expect, test } from "vitest";
import {
  NEW_GESTURE_MS,
  REACQUIRE_PEAK_RATIO,
  RELEASE_LOCK_MS,
  MAX_WHEEL_IDLE_MS,
  MAX_RELEASE_DURATION_MS,
  MIN_WHEEL_IDLE_MS,
  MIN_RELEASE_DURATION_MS,
  WHEEL_IDLE_MS,
  advancePull,
  inputDistance,
  nextWheelFlow,
  releaseDuration,
  rubberBandDistance,
  scrollBoundary,
  wheelIdleDelay,
  wheelPixels
} from "../src/lib/scroll-boundary";

describe("scroll boundary geometry", () => {
  test("recognizes only real document edges", () => {
    expect(scrollBoundary(0, 500)).toBe("top");
    expect(scrollBoundary(0.75, 500)).toBe("top");
    expect(scrollBoundary(250, 500)).toBeNull();
    expect(scrollBoundary(499.25, 500)).toBe("bottom");
    expect(scrollBoundary(500, 500)).toBe("bottom");
    expect(scrollBoundary(0, 1)).toBeNull();
  });

  test("resistance is monotonic, bounded and progressively stronger", () => {
    const raw = [0, 80, 160, 240, 320, 400, 480];
    const visible = raw.map((distance) => rubberBandDistance(distance, 900));
    const increments = visible.slice(1).map((value, index) => value - visible[index]!);
    expect(visible[0]).toBe(0);
    expect(visible.every((value, index) => index === 0 || value > visible[index - 1]!)).toBe(true);
    expect(increments.every((value, index) => index === 0 || value < increments[index - 1]!)).toBe(
      true
    );
    expect(visible.at(-1)).toBeLessThanOrEqual(56);
  });

  test("the inverse resistance curve preserves an in-flight position", () => {
    for (const viewport of [320, 844, 1800]) {
      for (const raw of [1, 17, 80, 240]) {
        const visible = rubberBandDistance(raw, viewport);
        expect(inputDistance(visible, viewport)).toBeCloseTo(raw, 5);
        expect(inputDistance(-visible, viewport)).toBeCloseTo(raw, 5);
      }
    }
  });

  test("reversal consumes the pull before handing a precise remainder to native scroll", () => {
    expect(advancePull(80, 30, "bottom")).toEqual({ distance: 110, remainder: 0 });
    expect(advancePull(80, -30, "bottom")).toEqual({ distance: 50, remainder: 0 });
    expect(advancePull(80, -110, "bottom")).toEqual({ distance: 0, remainder: -30 });
    expect(advancePull(80, -30, "top").distance).toBe(110);
    expect(advancePull(80, -30, "top").remainder).toBeCloseTo(0);
    expect(advancePull(80, 110, "top")).toEqual({ distance: 0, remainder: 30 });
  });

  test("normalizes pixel, line and page wheel modes", () => {
    expect(wheelPixels(4, 0, 20, 800)).toBe(4);
    expect(wheelPixels(4, 1, 20, 800)).toBe(80);
    expect(wheelPixels(0.5, 2, 20, 800)).toBe(400);
  });
});

describe("wheel intent classifier", () => {
  test("the quiet window adapts to cadence without exceeding interaction bounds", () => {
    const first = nextWheelFlow(15, 0);
    expect(wheelIdleDelay(undefined, 0)).toBe(WHEEL_IDLE_MS);
    expect(wheelIdleDelay(first, 80)).toBe(MIN_WHEEL_IDLE_MS);
    expect(wheelIdleDelay(first, 150)).toBe(180);
    expect(wheelIdleDelay(first, 180)).toBe(MAX_WHEEL_IDLE_MS);
  });

  test("equal 80-100ms input stays active without a release phase", () => {
    for (const interval of [80, 90, 100]) {
      let flow = nextWheelFlow(15, 0);
      for (let index = 1; index < 24; index++) {
        flow = nextWheelFlow(15, index * interval, flow);
        expect(flow.phase).toBe("active");
      }
    }
  });

  test("a confirmed declining tail releases once and ignores weaker residue", () => {
    let flow = nextWheelFlow(60, 0);
    flow = nextWheelFlow(42, 16, flow);
    expect(flow.phase).toBe("active");
    flow = nextWheelFlow(28, 32, flow);
    expect(flow.phase).toBe("active");
    flow = nextWheelFlow(18, 48, flow);
    expect(flow.phase).toBe("active");
    flow = nextWheelFlow(12, 64, flow);
    expect(flow.phase).toBe("tail");
    for (const [index, magnitude] of [8, 5, 3, 2, 1, 0.5].entries()) {
      flow = nextWheelFlow(magnitude, 80 + index * 16, flow);
      expect(flow.phase).toBe("tail");
    }
  });

  test("a realistic five-percent decay with light noise is recognized as inertia", () => {
    let flow = nextWheelFlow(40, 0);
    for (const [index, magnitude] of [38, 36.1, 36.4, 34.3, 32.6, 31].entries())
      flow = nextWheelFlow(magnitude, (index + 1) * 16, flow);
    expect(flow.phase).toBe("tail");
    expect(flow.peak).toBe(40);
  });

  test("only strong new effort or a genuine time gap can reacquire control", () => {
    let flow = nextWheelFlow(60, 0);
    flow = nextWheelFlow(42, 16, flow);
    flow = nextWheelFlow(28, 32, flow);
    flow = nextWheelFlow(18, 48, flow);
    flow = nextWheelFlow(12, 64, flow);
    expect(flow.phase).toBe("tail");
    flow = nextWheelFlow(54, 64, flow);
    expect(flow.phase).toBe("active");

    const idle = { ...flow, phase: "idle" as const };
    expect(nextWheelFlow(1, idle.time + NEW_GESTURE_MS, idle).phase).toBe("active");
  });

  test("sparse weakening packets do not repeatedly recapture an idle release", () => {
    let flow = nextWheelFlow(20, 0);
    flow = { ...flow, phase: "idle" };
    for (const [index, magnitude] of [19.6, 19.2, 18.8, 18.4].entries()) {
      flow = nextWheelFlow(magnitude, 150 * (index + 1), flow);
      expect(flow.phase).toBe("idle");
    }
  });

  test("a weaker residual packet after settling cannot restart the release", () => {
    const idle = { ...nextWheelFlow(40, 0), phase: "idle" as const };
    expect(nextWheelFlow(18, 220, idle).phase).toBe("idle");
    expect(nextWheelFlow(18, RELEASE_LOCK_MS, idle).phase).toBe("active");
  });

  test("noisy same-direction inertia stays locked after release", () => {
    let flow = nextWheelFlow(52, 0);
    for (const [index, magnitude] of [43, 34, 25, 17].entries())
      flow = nextWheelFlow(magnitude, (index + 1) * 16, flow);
    expect(flow.phase).toBe("tail");
    for (const [index, magnitude] of [12, 7, 10, 5, 8, 3].entries()) {
      flow = nextWheelFlow(magnitude, 80 + index * 16, flow);
      expect(flow.phase).toBe("tail");
    }
  });

  test("direction changes always start a fresh active gesture", () => {
    const outward = nextWheelFlow(25, 0);
    const reverse = nextWheelFlow(-1, 10, { ...outward, phase: "tail" });
    expect(reverse.phase).toBe("active");
    expect(reverse.direction).toBe(-1);
  });
});

test("interaction timings stay inside the reviewed envelope", () => {
  expect(WHEEL_IDLE_MS).toBeGreaterThanOrEqual(110);
  expect(WHEEL_IDLE_MS).toBeLessThan(200);
  expect(MIN_WHEEL_IDLE_MS).toBeLessThan(WHEEL_IDLE_MS);
  expect(MAX_WHEEL_IDLE_MS).toBeLessThanOrEqual(200);
  expect(NEW_GESTURE_MS).toBeGreaterThan(WHEEL_IDLE_MS * 2);
  expect(RELEASE_LOCK_MS).toBeGreaterThan(MAX_WHEEL_IDLE_MS);
  expect(RELEASE_LOCK_MS).toBeLessThan(NEW_GESTURE_MS);
  expect(REACQUIRE_PEAK_RATIO).toBeGreaterThan(0.75);
  expect(MIN_RELEASE_DURATION_MS).toBeGreaterThan(0);
  expect(MAX_RELEASE_DURATION_MS).toBeLessThanOrEqual(200);
  expect(releaseDuration(0)).toBe(MIN_RELEASE_DURATION_MS);
  expect(releaseDuration(20)).toBeGreaterThan(MIN_RELEASE_DURATION_MS);
  expect(releaseDuration(500)).toBe(MAX_RELEASE_DURATION_MS);
});
