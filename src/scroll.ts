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
  // --- Y axis ---
  const midpointViewY = midpointWorld.y - state.windowPos.y - config.statusBarOffset;

  if (forceVector.y >= 0) {
    // Moving down or stationary
    if (midpointViewY >= config.yScrollDownTrigger) {
      // Outside dead zone — engage scrolling at force speed
      state.scrollSpeed.y = forceVector.y + 1;
    } else if (state.scrollSpeed.y > 0) {
      // Inside dead zone but still scrolling down — decelerate
      if (forceVector.y + 1 < state.scrollSpeed.y) {
        state.scrollSpeed.y--;
        if (state.scrollSpeed.y === 0) state.scrollSpeed.y = 1; // avoid sign flip
      }
    }
  } else {
    // Moving up
    if (midpointViewY < config.yScrollUpTrigger) {
      state.scrollSpeed.y = forceVector.y - 1;
    } else if (state.scrollSpeed.y < 0) {
      if (state.scrollSpeed.y < forceVector.y) {
        state.scrollSpeed.y++;
        if (state.scrollSpeed.y === 0) state.scrollSpeed.y = -1;
      }
    }
  }

  // Brake zone hard stop for Y
  if (state.scrollSpeed.y > 0 && midpointViewY < config.yBrakeUpStop) {
    state.scrollSpeed.y = 0;
  }
  if (state.scrollSpeed.y < 0 && midpointViewY > config.yBrakeDownStop) {
    state.scrollSpeed.y = 0;
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
