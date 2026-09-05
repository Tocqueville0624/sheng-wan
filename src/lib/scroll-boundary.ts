type Boundary = "top" | "bottom";

export const MIN_WHEEL_IDLE_MS = 110;
export const WHEEL_IDLE_MS = 150;
export const MAX_WHEEL_IDLE_MS = 180;
export const NEW_GESTURE_MS = 400;
export const RELEASE_LOCK_MS = 240;
export const REACQUIRE_PEAK_RATIO = 0.82;
export const MIN_RELEASE_DURATION_MS = 140;
export const MAX_RELEASE_DURATION_MS = 180;

export type WheelFlow = {
  direction: number;
  magnitude: number;
  peak: number;
  trough: number;
  declines: number;
  time: number;
  phase: "active" | "tail" | "idle";
};

const freshWheelFlow = (delta: number, time: number): WheelFlow => ({
  direction: Math.sign(delta),
  magnitude: Math.abs(delta),
  peak: Math.abs(delta),
  trough: Math.abs(delta),
  declines: 0,
  time,
  phase: "active"
});

/**
 * Wheel events expose neither finger contact nor release. This classifier only
 * separates a sustained declining tail from renewed effort. Active input keeps
 * direct input-coupled trajectory; a confirmed release starts one return tween.
 */
export function nextWheelFlow(delta: number, time: number, previous?: WheelFlow): WheelFlow {
  const magnitude = Math.abs(delta);
  const direction = Math.sign(delta);
  if (!previous || direction !== previous.direction) return freshWheelFlow(delta, time);

  const gap = time - previous.time;
  if (previous.phase === "idle") {
    if (
      gap >= RELEASE_LOCK_MS ||
      (magnitude >= previous.peak * REACQUIRE_PEAK_RATIO && magnitude >= previous.magnitude * 1.35)
    )
      return freshWheelFlow(delta, time);
    return { ...previous, magnitude, trough: Math.min(previous.trough, magnitude), time };
  }
  if (previous.phase === "tail") {
    if (
      gap >= NEW_GESTURE_MS ||
      (magnitude >= previous.peak * REACQUIRE_PEAK_RATIO && magnitude >= previous.magnitude * 1.35)
    )
      return freshWheelFlow(delta, time);
    return { ...previous, magnitude, trough: Math.min(previous.trough, magnitude), time };
  }
  if (gap >= NEW_GESTURE_MS) return freshWheelFlow(delta, time);

  // Track a sustained non-growing trend rather than demanding a large drop in
  // every packet. Real trackpad inertia often decays by only ~5% per frame and
  // can contain small quantization noise.
  const declines = magnitude <= previous.magnitude * 1.025 ? previous.declines + 1 : 0;
  const peak = Math.max(previous.peak, magnitude);
  const phase = declines >= 4 && magnitude <= peak * 0.8 ? "tail" : "active";
  return {
    direction,
    magnitude,
    peak,
    trough: Math.min(previous.trough, magnitude),
    declines,
    time,
    phase
  };
}

export function wheelIdleDelay(previous: WheelFlow | undefined, time: number) {
  if (!previous || previous.phase !== "active") return WHEEL_IDLE_MS;
  const cadence = time - previous.time;
  if (cadence <= 0 || cadence >= NEW_GESTURE_MS) return WHEEL_IDLE_MS;
  return Math.min(MAX_WHEEL_IDLE_MS, Math.max(MIN_WHEEL_IDLE_MS, cadence * 1.25));
}

/** Keep short pulls crisp while giving larger stretches enough time to settle. */
export function releaseDuration(distance: number) {
  return Math.min(
    MAX_RELEASE_DURATION_MS,
    MIN_RELEASE_DURATION_MS + (Math.abs(distance) / 56) * 40
  );
}

export function scrollBoundary(position: number, maximum: number): Boundary | null {
  if (maximum <= 1) return null;
  if (position <= 1) return "top";
  if (position >= maximum - 1) return "bottom";
  return null;
}

/** Bounded displacement with increasing resistance. */
export function rubberBandDistance(distance: number, viewport: number): number {
  const limit = Math.min(56, Math.max(1, viewport) * 0.065);
  const positive = Math.max(0, distance);
  return (limit * positive) / (positive + limit / 0.48);
}

export function inputDistance(displacement: number, viewport: number): number {
  const limit = Math.min(56, Math.max(1, viewport) * 0.065);
  const bounded = Math.min(Math.abs(displacement), limit - 0.001);
  return (bounded * (limit / 0.48)) / (limit - bounded);
}

export function wheelPixels(delta: number, mode: number, lineHeight: number, viewport: number) {
  return delta * (mode === 1 ? lineHeight : mode === 2 ? viewport : 1);
}

export function advancePull(distance: number, delta: number, edge: Boundary) {
  const direction = edge === "top" ? -1 : 1;
  const next = distance + direction * delta;
  return { distance: Math.max(0, next), remainder: Math.min(0, next) * direction };
}

export function setupScrollBoundaryFeedback() {
  const root = document.documentElement;
  const surface = document.querySelector<HTMLElement>(".site-page");
  if (!surface || root.dataset.boundaryFeedbackReady) return;

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let offsetValue = 0;
  let paintFrame = 0;
  let returnAnimation: Animation | undefined;
  let viewportHeight = innerHeight;
  let maximumScroll = root.scrollHeight - viewportHeight;
  let lineHeight = parseFloat(getComputedStyle(document.body).lineHeight) || 16;
  let controlCache = new WeakMap<Element, boolean>();
  let lastWheelAt = 0;
  let edge: Boundary | null = null;
  let distance = 0;
  let released = false;
  let animationVersion = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let wheelFlow: WheelFlow | undefined;
  let wheelListening = false;
  let detachTouchListeners = () => {};
  let touch:
    | {
        y: number;
        startX: number;
        startY: number;
        vertical: boolean;
        captured: boolean;
        handedOff: boolean;
      }
    | undefined;

  const maximum = () => maximumScroll;
  const enabled = () =>
    !reducedMotion.matches && !document.hidden && Math.abs((visualViewport?.scale ?? 1) - 1) < 0.01;
  const modalIsOpen = () => document.querySelector("dialog[open], [popover]:popover-open") !== null;

  const belongsToNestedControl = (eventTarget: EventTarget | null) => {
    if (!(eventTarget instanceof Element)) return false;
    const cached = controlCache.get(eventTarget);
    if (cached !== undefined) return cached;
    if (
      eventTarget.closest(
        "input, textarea, select, [contenteditable], [role='slider'], [data-scroll-boundary-ignore]"
      )
    ) {
      controlCache.set(eventTarget, true);
      return true;
    }
    for (
      let element: Element | null = eventTarget;
      element && element !== document.body;
      element = element.parentElement
    ) {
      const style = getComputedStyle(element);
      if (
        (/auto|scroll|overlay/.test(style.overflowY) &&
          element.scrollHeight > element.clientHeight + 1) ||
        (/auto|scroll|overlay/.test(style.overflowX) &&
          element.scrollWidth > element.clientWidth + 1)
      ) {
        controlCache.set(eventTarget, true);
        return true;
      }
    }
    controlCache.set(eventTarget, false);
    return false;
  };

  const writeOffset = (value: number) => {
    if (Math.abs(value) < 0.01) surface.style.removeProperty("transform");
    else surface.style.transform = `translate3d(0, ${value}px, 0)`;
  };

  // Input may arrive faster than the display refresh rate. Commit once per frame;
  // the compositor owns the return animation rather than a JS animation loop.
  const flushOffset = () => {
    cancelAnimationFrame(paintFrame);
    paintFrame = 0;
    writeOffset(offsetValue);
  };
  const cancelReturn = () => {
    if (!returnAnimation) return;
    returnAnimation.onfinish = null;
    returnAnimation.cancel();
    returnAnimation = undefined;
  };
  const offset = {
    get: () =>
      returnAnimation
        ? new DOMMatrixReadOnly(getComputedStyle(surface).transform).m42
        : offsetValue,
    jump: (value: number) => {
      cancelReturn();
      offsetValue = value;
      if (!paintFrame) paintFrame = requestAnimationFrame(flushOffset);
    }
  };

  const settleFeedback = () => {
    clearTimeout(idleTimer);
    cancelReturn();
    cancelAnimationFrame(paintFrame);
    paintFrame = 0;
    offsetValue = 0;
    edge = null;
    distance = 0;
    released = false;
    surface.style.removeProperty("transform");
    surface.removeAttribute("data-boundary-active");
    delete root.dataset.boundaryFeedback;
    delete root.dataset.boundaryState;
    if (wheelFlow?.phase === "tail") wheelFlow = { ...wheelFlow, phase: "idle" };
    updateWheel();
  };

  const resetVisual = (preserveTouch = false) => {
    clearTimeout(idleTimer);
    wheelFlow = undefined;
    edge = null;
    distance = 0;
    released = false;
    if (!preserveTouch) {
      detachTouchListeners();
      touch = undefined;
    }
    animationVersion += 1;
    offset.jump(0);
    flushOffset();
    surface.style.removeProperty("transform");
    surface.removeAttribute("data-boundary-active");
    delete root.dataset.boundaryFeedback;
    delete root.dataset.boundaryState;
  };

  const hardReset = () => resetVisual();

  const release = () => {
    clearTimeout(idleTimer);
    if (released) return;
    if (!edge && Math.abs(offset.get()) <= 0.1) return;
    distance = 0;
    released = true;
    root.dataset.boundaryState = "releasing";
    if (Math.abs(offset.get()) <= 0.1) {
      offset.jump(0);
      settleFeedback();
      return;
    }
    const version = ++animationVersion;
    const duration = releaseDuration(offset.get());
    const from = offset.get();
    cancelReturn();
    offsetValue = from;
    flushOffset();
    returnAnimation = surface.animate(
      [{ transform: `translate3d(0, ${from}px, 0)` }, { transform: "translate3d(0, 0, 0)" }],
      { duration, easing: "cubic-bezier(0.25, 0, 0.35, 1)", fill: "forwards" }
    );
    returnAnimation.onfinish = () => {
      if (released && version === animationVersion) settleFeedback();
    };
  };

  const activate = (boundary: Boundary) => {
    animationVersion += 1;
    edge = boundary;
    released = false;
    root.dataset.boundaryFeedback = boundary;
    root.dataset.boundaryState = "pulling";
    surface.setAttribute("data-boundary-active", "");
  };

  const pull = (delta: number) => {
    if (!edge) {
      const boundary = scrollBoundary(scrollY, maximum());
      if ((boundary === "top" && delta < 0) || (boundary === "bottom" && delta > 0))
        activate(boundary);
      else return { handled: false, remainder: delta };
    }
    const activeEdge = edge;
    if (!activeEdge) return { handled: false, remainder: delta };
    const inward = (activeEdge === "top" && delta > 0) || (activeEdge === "bottom" && delta < 0);
    const wasReleased = released;
    if (wasReleased && !inward && Math.abs(offset.get()) > 0.1) {
      const currentOffset = offset.get();
      offset.jump(currentOffset);
      distance = inputDistance(currentOffset, viewportHeight);
    }
    if (wasReleased && inward) {
      hardReset();
      return { handled: true, remainder: delta };
    }
    if (inward && Math.abs(offset.get()) > 0.1)
      distance = inputDistance(offset.get(), viewportHeight);
    const next = advancePull(distance, delta, activeEdge);
    distance = next.distance;
    const nextOffset =
      rubberBandDistance(distance, viewportHeight) * (activeEdge === "top" ? 1 : -1);
    if (distance === 0) {
      release();
    } else {
      activate(activeEdge);
      // Native elastic scrolling tracks the gesture rather than chasing it.
      // jump() also cuts any in-flight release before applying the new input.
      offset.jump(nextOffset);
    }
    return { handled: true, remainder: next.remainder };
  };

  const onWheel = (event: WheelEvent) => {
    if (!event.deltaX && !event.deltaY) return;
    const eventTime = performance.now();
    if (eventTime - lastWheelAt >= NEW_GESTURE_MS) controlCache = new WeakMap();
    lastWheelAt = eventTime;
    if (!enabled() || modalIsOpen()) {
      refresh();
      return;
    }
    if (
      event.defaultPrevented ||
      !event.cancelable ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      belongsToNestedControl(event.target) ||
      Math.abs(event.deltaY) <= Math.abs(event.deltaX)
    ) {
      if (edge || surface.hasAttribute("data-boundary-active")) release();
      return;
    }

    const delta = wheelPixels(event.deltaY, event.deltaMode, lineHeight, viewportHeight);
    const boundary = edge ?? scrollBoundary(scrollY, maximum());
    const outward = (boundary === "top" && delta < 0) || (boundary === "bottom" && delta > 0);
    if (outward) {
      const now = performance.now();
      const previousFlow = wheelFlow;
      const previousPhase = wheelFlow?.phase;
      wheelFlow = nextWheelFlow(delta, now, wheelFlow);
      event.preventDefault();
      if (wheelFlow.phase !== "active") {
        if (previousPhase === "active") release();
        return;
      }
      if (
        (released || (previousPhase && previousPhase !== "active")) &&
        Math.abs(offset.get()) > 0.1
      )
        distance = inputDistance(offset.get(), viewportHeight);
      const result = pull(delta);
      if (result.remainder) scrollBy({ top: result.remainder, behavior: "instant" });
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => {
          if (wheelFlow?.phase === "active") wheelFlow = { ...wheelFlow, phase: "idle" };
          release();
        },
        wheelIdleDelay(previousFlow, now)
      );
      return;
    }

    wheelFlow = undefined;
    if (!edge) return;
    event.preventDefault();
    const result = pull(delta);
    if (result.remainder) {
      hardReset();
      scrollBy({ top: result.remainder, behavior: "instant" });
    }
  };

  const addWheel = () => {
    if (wheelListening) return;
    addEventListener("wheel", onWheel, { passive: false });
    wheelListening = true;
  };
  const removeWheel = () => {
    if (!wheelListening) return;
    removeEventListener("wheel", onWheel);
    wheelListening = false;
  };
  const updateWheel = () => {
    if (enabled() && !modalIsOpen() && (edge || scrollBoundary(scrollY, maximum()))) addWheel();
    else removeWheel();
  };

  const onScroll = () => {
    if (edge && scrollBoundary(scrollY, maximum()) !== edge) hardReset();
    updateWheel();
  };

  const finishTouch = () => {
    detachTouchListeners();
    if (touch?.captured) release();
    touch = undefined;
    updateWheel();
  };

  const onTouchMove = (event: TouchEvent) => {
    if (!enabled() || modalIsOpen()) {
      hardReset();
      return;
    }
    const point = event.touches[0];
    if (!touch || !point || event.touches.length !== 1) {
      finishTouch();
      return;
    }
    if (event.defaultPrevented || !event.cancelable) {
      finishTouch();
      return;
    }
    const xDistance = Math.abs(point.clientX - touch.startX);
    const yDistance = Math.abs(point.clientY - touch.startY);
    if (!touch.vertical && Math.max(xDistance, yDistance) >= 4) {
      if (xDistance > yDistance) {
        finishTouch();
        return;
      }
      touch.vertical = true;
    }
    if (!touch.vertical) return;
    const delta = touch.y - point.clientY;
    touch.y = point.clientY;
    if (touch.handedOff) {
      event.preventDefault();
      if (event.defaultPrevented) scrollBy({ top: delta, behavior: "instant" });
      return;
    }
    const result = pull(delta);
    if (!result.handled) return;
    touch.captured = true;
    event.preventDefault();
    if (event.defaultPrevented && result.remainder) {
      resetVisual(true);
      scrollBy({ top: result.remainder, behavior: "instant" });
      touch.handedOff = true;
    }
  };

  const onTouchEnd = () => finishTouch();

  detachTouchListeners = () => {
    removeEventListener("touchmove", onTouchMove);
    removeEventListener("touchend", onTouchEnd);
    removeEventListener("touchcancel", onTouchEnd);
  };

  const onTouchStart = (event: TouchEvent) => {
    controlCache = new WeakMap();
    const point = event.touches[0];
    const boundary = scrollBoundary(scrollY, maximum());
    if (
      !point ||
      event.touches.length !== 1 ||
      !boundary ||
      !enabled() ||
      modalIsOpen() ||
      belongsToNestedControl(event.target)
    )
      return;
    clearTimeout(idleTimer);
    wheelFlow = undefined;
    if (edge && Math.abs(offset.get()) > 0.1)
      distance = inputDistance(offset.get(), viewportHeight);
    touch = {
      y: point.clientY,
      startX: point.clientX,
      startY: point.clientY,
      vertical: false,
      captured: false,
      handedOff: false
    };
    addEventListener("touchmove", onTouchMove, { passive: false });
    addEventListener("touchend", onTouchEnd, { passive: true });
    addEventListener("touchcancel", onTouchEnd, { passive: true });
  };

  const refresh = () => {
    root.toggleAttribute("data-boundary-enhanced", enabled());
    if (!enabled() || modalIsOpen()) hardReset();
    updateWheel();
  };
  const resize = () => {
    viewportHeight = innerHeight;
    maximumScroll = root.scrollHeight - viewportHeight;
    lineHeight = parseFloat(getComputedStyle(document.body).lineHeight) || 16;
    controlCache = new WeakMap();
    hardReset();
    refresh();
  };

  const resetForNewNavigation = () => {
    if (edge || surface.hasAttribute("data-boundary-active")) hardReset();
    updateWheel();
  };

  root.dataset.boundaryFeedbackReady = "true";
  root.toggleAttribute("data-boundary-enhanced", enabled());
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("touchstart", onTouchStart, { passive: true });
  addEventListener("resize", resize, { passive: true });
  addEventListener("pagehide", hardReset, { passive: true });
  addEventListener("keydown", resetForNewNavigation, { passive: true });
  addEventListener("focusin", resetForNewNavigation, { passive: true });
  addEventListener("hashchange", resetForNewNavigation, { passive: true });
  document.addEventListener("visibilitychange", refresh);
  document.addEventListener("beforetoggle", resetForNewNavigation, true);
  document.addEventListener("toggle", refresh, true);
  reducedMotion.addEventListener("change", refresh);
  visualViewport?.addEventListener("resize", resize, { passive: true });
  new ResizeObserver(resize).observe(surface);
  requestAnimationFrame(updateWheel);
}
