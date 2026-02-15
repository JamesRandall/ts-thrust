# Scrolling Dead Zone System — Reference from BBC Micro *Thrust* (1986)

Extracted from the annotated 6502 disassembly of *Thrust* by Jeremy C. Smith (disassembly by Kieran HJ Connell, 2016). This describes the camera/viewport scrolling behaviour for implementation in a TypeScript game engine.

## Overview

The camera tracks a **midpoint position** — not the player directly. When a pod is attached to the ship, the midpoint is calculated as the average of the ship and pod positions. When flying solo, the midpoint is the ship position. All scrolling decisions are made against this midpoint.

The viewport only scrolls when the midpoint leaves a central **dead zone**. Inside the dead zone the camera is stationary, giving the player freedom to manoeuvre without constant screen movement. When the midpoint exits the dead zone, scrolling engages proportionally to the current force/velocity, with a secondary **brake zone** that decelerates scrolling back to zero as the midpoint returns toward centre.

## Coordinate System

- **World coordinates** are Q7.8 fixed-point (X) and Q10.8 fixed-point (Y, since worlds are several screens deep).
- **Window position** (`window_xpos`, `window_ypos`) is the top-left corner of the viewport in world space.
- **Midpoint window position** is the midpoint's offset relative to the window — i.e. its position in screen/viewport space.

For Y, the visible area begins below a status bar offset of `0x38` (56) pixels, so:

```
midpoint_window_y = midpoint_ypos - window_ypos - STATUS_BAR_OFFSET
```

For X there is no offset:

```
midpoint_window_x = midpoint_xpos - window_xpos
```

## Dead Zone Thresholds

### Y Axis

| Threshold | Hex | Decimal | Purpose |
|-----------|-----|---------|---------|
| Scroll-up trigger | `0x2F` | 47 | Midpoint above this → start scrolling up |
| Brake-up stop | `0x3C` | 60 | Scrolling down is zeroed if midpoint drops below this |
| Brake-down stop | `0x50` | 80 | Scrolling up is zeroed if midpoint rises above this |
| Scroll-down trigger | `0x5D` | 93 | Midpoint below this → start scrolling down |

- **Dead zone height**: `0x5D - 0x2F` = **46 pixels**
- **Brake zone** (inner band where active scrolling decelerates to zero): between `0x3C` and `0x50` = **20 pixels**

### X Axis

| Threshold | Hex | Decimal | Purpose |
|-----------|-----|---------|---------|
| Scroll-left trigger | `0x10` | 16 | Midpoint left of this → start scrolling left |
| Brake-left stop | `0x1D` | 29 | Rightward scrolling is zeroed if midpoint drops below this |
| Brake-right stop | `0x23` | 35 | Leftward scrolling is zeroed if midpoint rises above this |
| Scroll-right trigger | `0x30` | 48 | Midpoint right of this → start scrolling right |

- **Dead zone width**: `0x30 - 0x10` = **32 pixels**
- **Brake zone**: between `0x1D` and `0x23` = **6 pixels**

## Proportions Relative to Visible Area

The dead zone occupies approximately:

- **~50%** of the visible viewport width
- **~33%** of the visible viewport height

These are large dead zones by modern standards, which is deliberate — the 6502 couldn't afford to redraw terrain every frame, so the system minimises unnecessary scrolling while still feeling responsive.

## Scroll Speed Behaviour

Scrolling speed is not constant. It is driven by the current **force vector** (essentially acceleration/velocity of the midpoint):

1. **Outside the dead zone**: `window_scroll` is set to the force vector value (plus or minus 1). The viewport accelerates to match the player's movement.
2. **Inside the dead zone but scrolling is active** (the brake zone): the scroll speed decrements toward zero by 1 per frame. If it reaches zero it is clamped to ±1 to avoid sign flip, then zeroed on the next check.
3. **Deep inside the dead zone** (past the brake-stop threshold): scroll speed is immediately zeroed.

This creates a smooth deceleration curve — the camera chases the player, catches up, then gently stops rather than snapping.

## Algorithm Pseudocode

```typescript
interface ScrollState {
  windowPos: { x: number; y: number };   // top-left of viewport in world space
  scrollSpeed: { x: number; y: number }; // current scroll velocity (signed)
}

interface ScrollConfig {
  statusBarOffset: number;  // e.g. 56

  // Y thresholds (in viewport-local coordinates)
  yScrollUpTrigger: number;    // 47  — above this, start scrolling up
  yBrakeUpStop: number;        // 60  — below this, zero out downward scroll
  yBrakeDownStop: number;      // 80  — above this, zero out upward scroll
  yScrollDownTrigger: number;  // 93  — below this, start scrolling down

  // X thresholds
  xScrollLeftTrigger: number;  // 16
  xBrakeLeftStop: number;      // 29
  xBrakeRightStop: number;     // 35
  xScrollRightTrigger: number; // 48
}

function updateScroll(
  midpointWorld: { x: number; y: number },
  forceVector: { x: number; y: number },
  state: ScrollState,
  config: ScrollConfig
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

  const xOffset = midpointViewX - config.xScrollLeftTrigger;
  if (xOffset < 0) {
    state.scrollSpeed.x = xOffset; // negative — scroll left
  } else {
    const rightOverflow = midpointViewX - config.xScrollRightTrigger;
    if (rightOverflow > 0) {
      state.scrollSpeed.x = rightOverflow; // positive — scroll right
    }
  }

  // Brake zone for X
  if (state.scrollSpeed.x > 0 && midpointViewX < config.xBrakeLeftStop) {
    state.scrollSpeed.x = 0;
  } else if (state.scrollSpeed.x > 0 && midpointViewX < config.xScrollRightTrigger) {
    state.scrollSpeed.x--;
    if (state.scrollSpeed.x === 0) state.scrollSpeed.x = 1;
  }

  if (state.scrollSpeed.x < 0 && midpointViewX > config.xBrakeRightStop) {
    state.scrollSpeed.x = 0;
  } else if (state.scrollSpeed.x < 0 && midpointViewX > config.xScrollLeftTrigger) {
    state.scrollSpeed.x++;
    if (state.scrollSpeed.x === 0) state.scrollSpeed.x = -1;
  }

  // Apply scroll to window position
  state.windowPos.x += state.scrollSpeed.x;
  state.windowPos.y += state.scrollSpeed.y;
}
```

## Adapting to Your Viewport

The original values assume a ~64×144 pixel visible world-coordinate viewport. To adapt to an arbitrary viewport size, scale the thresholds proportionally:

```typescript
function createScrollConfig(
  viewportWidth: number,
  viewportHeight: number,
  statusBarHeight: number = 0
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
```

## Key Design Principles

1. **Track the midpoint, not the player** — when the ship is tethered to a payload, the camera follows the centre of mass between the two, preventing either from going off-screen.
2. **Large dead zone** — the player can manoeuvre freely within roughly half the screen without triggering scrolling. This feels natural for a gravity/thrust game where fine positional control matters.
3. **Velocity-matched scrolling** — scroll speed matches the player's force vector rather than using a fixed chase speed. This prevents the camera from lagging during fast movement or jittering during slow movement.
4. **Smooth deceleration** — the brake zone prevents the camera from stopping abruptly. Scroll speed ramps down by 1 per frame with a sign-flip guard.
5. **Asymmetric zones** — the X brake zone (6px) is much tighter than the Y brake zone (20px), reflecting the fact that horizontal movement in Thrust is quicker and more responsive than vertical movement against gravity.
