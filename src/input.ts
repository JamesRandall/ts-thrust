/**
 * Input abstraction layer for Thrust.
 *
 * All game input flows through this module. In normal play the inputs
 * come from the real keyboard; in demo mode a scripted bitmask is
 * substituted transparently.
 *
 * Based on the original BBC Micro input system (test_inkey).
 */

// ---------------------------------------------------------------------------
// Input bit flags — each action maps to a single bit in a bitmask.
// Matches the original 6502 layout.
// ---------------------------------------------------------------------------

export const INPUT_ROTATE_LEFT    = 0x01;
export const INPUT_ROTATE_RIGHT   = 0x02;
export const INPUT_FIRE           = 0x04;
export const INPUT_THRUST         = 0x08;
export const INPUT_SHIELD_TRACTOR = 0x10;

// ---------------------------------------------------------------------------
// Structured game input — the common interface consumed by tick() and
// sound/rendering logic in main.ts.
// ---------------------------------------------------------------------------

export interface GameInput {
  rotateLeft: boolean;
  rotateRight: boolean;
  fire: boolean;
  thrust: boolean;
  shieldTractor: boolean;
}

// ---------------------------------------------------------------------------
// Key code → InputBit mapping (real keyboard)
// ---------------------------------------------------------------------------

const KEY_ROTATE_LEFT  = "KeyA";
const KEY_ROTATE_RIGHT = "KeyD";
const KEY_FIRE         = "Enter";
const KEY_THRUST       = "KeyW";
const KEY_SHIELD       = "Space";

/**
 * Build a GameInput from real keyboard state.
 * Death-gating is NOT applied here — that is the caller's responsibility.
 */
export function gameInputFromKeys(keys: Set<string>): GameInput {
  return {
    rotateLeft:    keys.has(KEY_ROTATE_LEFT),
    rotateRight:   keys.has(KEY_ROTATE_RIGHT),
    fire:          keys.has(KEY_FIRE),
    thrust:        keys.has(KEY_THRUST),
    shieldTractor: keys.has(KEY_SHIELD),
  };
}

/**
 * Build a GameInput from a demo-mode bitmask.
 */
export function gameInputFromDemoBitmask(bitmask: number): GameInput {
  return {
    rotateLeft:    (bitmask & INPUT_ROTATE_LEFT) !== 0,
    rotateRight:   (bitmask & INPUT_ROTATE_RIGHT) !== 0,
    fire:          (bitmask & INPUT_FIRE) !== 0,
    thrust:        (bitmask & INPUT_THRUST) !== 0,
    shieldTractor: (bitmask & INPUT_SHIELD_TRACTOR) !== 0,
  };
}
