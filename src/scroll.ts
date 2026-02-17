export interface ScrollState {
  windowPos: { x: number; y: number };
  scrollSpeed: { x: number; y: number };
}

export interface ScrollConfig {
  statusBarOffset: number;

  // Y thresholds (in viewport-local world coordinates)
  yScrollUpTrigger: number;
  yBrakeUpStop: number;
  yBrakeDownStop: number;
  yScrollDownTrigger: number;

  // X thresholds
  xScrollLeftTrigger: number;
  xBrakeLeftStop: number;
  xBrakeRightStop: number;
  xScrollRightTrigger: number;
}

export function createScrollConfig(
  viewportWidth: number,
  viewportHeight: number,
  statusBarHeight: number = 0,
): ScrollConfig {
  return {
    statusBarOffset: statusBarHeight,

    // Y: dead zone is ~33% of height, centred
    yScrollUpTrigger:   Math.round(viewportHeight * 0.33),
    yBrakeUpStop:       Math.round(viewportHeight * 0.42),
    yBrakeDownStop:     Math.round(viewportHeight * 0.56),
    yScrollDownTrigger: Math.round(viewportHeight * 0.65),

    // X: dead zone is ~50% of width, centred
    xScrollLeftTrigger:  Math.round(viewportWidth * 0.25),
    xBrakeLeftStop:      Math.round(viewportWidth * 0.45),
    xBrakeRightStop:     Math.round(viewportWidth * 0.55),
    xScrollRightTrigger: Math.round(viewportWidth * 0.75),
  };
}

export function createScrollState(
  midpointX: number,
  midpointY: number,
  viewportWidth: number,
  viewportHeight: number,
  statusBarOffset: number,
): ScrollState {
  return {
    windowPos: {
      x: midpointX - viewportWidth / 2,
      y: midpointY - (viewportHeight + statusBarOffset) / 2,
    },
    scrollSpeed: { x: 0, y: 0 },
  };
}

export function updateScroll(
  midpointWorld: { x: number; y: number },
  forceVector: { x: number; y: number },
  state: ScrollState,
  config: ScrollConfig,
): void {
  // --- Y axis (proportional to overshoot, same approach as X) ---
  const midpointViewY = midpointWorld.y - state.windowPos.y - config.statusBarOffset;

  if (midpointViewY < config.yScrollUpTrigger) {
    // Outside dead zone above — scroll speed proportional to overshoot
    state.scrollSpeed.y = midpointViewY - config.yScrollUpTrigger;
  } else if (midpointViewY > config.yScrollDownTrigger) {
    // Outside dead zone below
    state.scrollSpeed.y = midpointViewY - config.yScrollDownTrigger;
  } else {
    // Inside dead zone — decelerate toward zero
    if (state.scrollSpeed.y > 0) {
      state.scrollSpeed.y = Math.max(0, state.scrollSpeed.y - 1);
    } else if (state.scrollSpeed.y < 0) {
      state.scrollSpeed.y = Math.min(0, state.scrollSpeed.y + 1);
    }
  }

  // --- X axis ---
  const midpointViewX = midpointWorld.x - state.windowPos.x;

  if (midpointViewX < config.xScrollLeftTrigger) {
    // Outside dead zone left — scroll speed proportional to overshoot
    state.scrollSpeed.x = midpointViewX - config.xScrollLeftTrigger;
  } else if (midpointViewX > config.xScrollRightTrigger) {
    // Outside dead zone right
    state.scrollSpeed.x = midpointViewX - config.xScrollRightTrigger;
  } else {
    // Inside dead zone — decelerate toward zero (float-safe, no sign-flip)
    if (state.scrollSpeed.x > 0) {
      state.scrollSpeed.x = Math.max(0, state.scrollSpeed.x - 1);
    } else if (state.scrollSpeed.x < 0) {
      state.scrollSpeed.x = Math.min(0, state.scrollSpeed.x + 1);
    }
  }

  // Apply scroll to window position
  state.windowPos.x += state.scrollSpeed.x;
  state.windowPos.y += state.scrollSpeed.y;
}
