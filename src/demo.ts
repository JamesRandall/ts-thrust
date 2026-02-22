/**
 * Demo / attract mode system for Thrust.
 *
 * Plays a scripted sequence of fake keypresses through the real game
 * engine. There is no separate demo renderer — the normal tick loop
 * runs with inputs injected from the keypress tables.
 *
 * Based on the original BBC Micro demo system reverse-engineered from
 * the Kieran Connell annotated disassembly.
 */

import {
  INPUT_ROTATE_LEFT,
  INPUT_ROTATE_RIGHT,
  INPUT_FIRE,
  INPUT_THRUST,
  INPUT_SHIELD_TRACTOR,
  gameInputFromDemoBitmask,
  GameInput,
} from "./input";

// ---------------------------------------------------------------------------
// Demo state
// ---------------------------------------------------------------------------

/**
 * Tick period matching the original BBC Micro tick loop.
 * The loop busy-waits until the system clock (1cs resolution) reaches 3,
 * giving ~33.3 ticks/second (one tick every 30ms / 3 centiseconds).
 */
const TICK_PERIOD_S = 3 / 100;

export interface DemoState {
  /** True while demo mode is active (scripted inputs are being injected) */
  active: boolean;
  /** Current fake key state — combination of INPUT_* bit flags */
  keypressBitMask: number;
  /** Ticks remaining for the current keypress entry */
  keypressTimer: number;
  /** Index into the keypress sequence tables */
  keypressIndex: number;
  /** Time accumulator — ensures demo ticks at the correct 30ms cadence */
  tickAccumulator: number;
}

export function createDemoState(): DemoState {
  return {
    active: false,
    keypressBitMask: 0x00,
    keypressTimer: 0,
    keypressIndex: 0,
    tickAccumulator: 0,
  };
}

// ---------------------------------------------------------------------------
// Keypress sequence — bitmask table
//
// Each entry defines WHICH keys are held for that segment. The
// parallel timer table (below) defines FOR HOW LONG.
// ---------------------------------------------------------------------------

const DEMO_INPUT_NOTHING                   = 0x00;
const DEMO_INPUT_ROTATE_RIGHT              = INPUT_ROTATE_RIGHT;
const DEMO_INPUT_FIRE                      = INPUT_FIRE;
const DEMO_INPUT_ROTATE_LEFT               = INPUT_ROTATE_LEFT;
const DEMO_INPUT_SHIELD_TRACTOR            = INPUT_SHIELD_TRACTOR;
const DEMO_INPUT_THRUST_AND_SHIELD         = INPUT_THRUST | INPUT_SHIELD_TRACTOR;
const DEMO_INPUT_THRUST                    = INPUT_THRUST;
const DEMO_INPUT_ROTATE_RIGHT_AND_THRUST   = INPUT_ROTATE_RIGHT | INPUT_THRUST;

const DEMO_KEYPRESS_BIT_MASK_TABLE: readonly number[] = [
  DEMO_INPUT_NOTHING,                   //  0: freefall
  DEMO_INPUT_ROTATE_RIGHT,              //  1: rotate right
  DEMO_INPUT_NOTHING,                   //  2: nothing
  DEMO_INPUT_FIRE,                      //  3: fire
  DEMO_INPUT_ROTATE_LEFT,               //  4: rotate left
  DEMO_INPUT_SHIELD_TRACTOR,            //  5: shield/tractor
  DEMO_INPUT_THRUST_AND_SHIELD,         //  6: thrust + shield
  DEMO_INPUT_NOTHING,                   //  7: nothing
  DEMO_INPUT_ROTATE_LEFT,               //  8: rotate left
  DEMO_INPUT_NOTHING,                   //  9: nothing
  DEMO_INPUT_THRUST_AND_SHIELD,         // 10: thrust + shield
  DEMO_INPUT_THRUST,                    // 11: thrust
  DEMO_INPUT_ROTATE_RIGHT_AND_THRUST,   // 12: rotate right + thrust
  DEMO_INPUT_THRUST,                    // 13: thrust
  DEMO_INPUT_ROTATE_RIGHT_AND_THRUST,   // 14: rotate right + thrust
  DEMO_INPUT_THRUST,                    // 15: thrust
  DEMO_INPUT_ROTATE_RIGHT_AND_THRUST,   // 16: rotate right + thrust
  DEMO_INPUT_THRUST,                    // 17: thrust
];

const DEMO_SEQUENCE_LENGTH = DEMO_KEYPRESS_BIT_MASK_TABLE.length;

// ---------------------------------------------------------------------------
// Keypress sequence — timer table
//
// Fixed entries 0–7; entries 8–17 have static defaults but three
// slots (8, 12, 13) are randomised at demo start.
// ---------------------------------------------------------------------------

// Timer durations (in game ticks at ~33 Hz)
const TIMER_FREEFALL            = 0x18;  // 24 ticks of nothing
const TIMER_ROTATE_RIGHT        = 0x0F;  // 15 ticks rotate right
const TIMER_PAUSE_SHORT         = 0x05;  //  5 ticks nothing
const TIMER_FIRE                = 0x05;  //  5 ticks fire
const TIMER_ROTATE_LEFT         = 0x08;  //  8 ticks rotate left
const TIMER_SHIELD_TRACTOR      = 0x14;  // 20 ticks shield/tractor
const TIMER_THRUST_SHIELD       = 0x17;  // 23 ticks thrust + shield
const TIMER_PAUSE_MEDIUM        = 0x0F;  // 15 ticks nothing
const TIMER_DEFAULT_SLOT_8      = 0x08;  // default for randomised slot 8
const TIMER_FIXED_SLOT_9        = 0x0D;  // 13 ticks (fixed)
const TIMER_FIXED_SLOT_10       = 0x26;  // 38 ticks (fixed)
const TIMER_FIXED_SLOT_11       = 0x0D;  // 13 ticks (fixed)
const TIMER_DEFAULT_SLOT_12     = 0x06;  // default for randomised slot 12
const TIMER_DEFAULT_SLOT_13     = 0x7F;  // 127 ticks — default big-spin value
const TIMER_FIXED_SLOT_14       = 0x14;  // 20 ticks (fixed)
const TIMER_FIXED_SLOT_15       = 0x0A;  // 10 ticks (fixed)
const TIMER_FIXED_SLOT_16       = 0x0F;  // 15 ticks (fixed)
const TIMER_FIXED_SLOT_17       = 0x7F;  // 127 ticks (fixed)

// Randomisation constants
const RND_A_MASK    = 0x03;   // AND mask for random range [0, 3]
const RND_A_BASE    = 0x08;   // slot 8 base: result in [8, 11]
const RND_B_MASK    = 0x03;
const RND_B_BASE    = 0x04;   // slot 12 base: result in [4, 7]
const RND_C_MASK    = 0x03;
const BIG_SPIN_LONG = 0x7F;   // 75% chance: long thrust+shield segment
const BIG_SPIN_SHORT = 0x23;  // 25% chance: short — tighter, more dramatic spiral

// Slot indices for the three randomised entries
const SLOT_RND_A = 8;
const SLOT_RND_B = 12;
const SLOT_RND_C = 13;

/**
 * The full 18-entry timer table. Slots 8, 12, 13 are overwritten at
 * each demo start by setupDemoTimers().
 */
const demoKeypressTimerTable: number[] = [
  TIMER_FREEFALL,
  TIMER_ROTATE_RIGHT,
  TIMER_PAUSE_SHORT,
  TIMER_FIRE,
  TIMER_ROTATE_LEFT,
  TIMER_SHIELD_TRACTOR,
  TIMER_THRUST_SHIELD,
  TIMER_PAUSE_MEDIUM,
  TIMER_DEFAULT_SLOT_8,
  TIMER_FIXED_SLOT_9,
  TIMER_FIXED_SLOT_10,
  TIMER_FIXED_SLOT_11,
  TIMER_DEFAULT_SLOT_12,
  TIMER_DEFAULT_SLOT_13,
  TIMER_FIXED_SLOT_14,
  TIMER_FIXED_SLOT_15,
  TIMER_FIXED_SLOT_16,
  TIMER_FIXED_SLOT_17,
];

// ---------------------------------------------------------------------------
// RNG — simple PRNG for demo timer randomisation
// ---------------------------------------------------------------------------

function demoRnd(): number {
  return Math.floor(Math.random() * 256);
}

// ---------------------------------------------------------------------------
// Demo setup
// ---------------------------------------------------------------------------

/**
 * Randomise the three variable timer slots. Called at the start of
 * each demo sequence.
 *
 * - Slot 8 (rnd_A):  (rnd & 0x03) + 0x08 → range [8, 11]
 * - Slot 12 (rnd_B): (rnd & 0x03) + 0x04 → range [4, 7]
 * - Slot 13 (rnd_C): 75% chance 0x7F (long), 25% chance 0x23 (short)
 */
export function setupDemoTimers(): void {
  demoKeypressTimerTable[SLOT_RND_A] = (demoRnd() & RND_A_MASK) + RND_A_BASE;
  demoKeypressTimerTable[SLOT_RND_B] = (demoRnd() & RND_B_MASK) + RND_B_BASE;

  // Big spin: 75% chance of long segment, 25% chance of short
  const bigSpin = (demoRnd() & RND_C_MASK) === 0 ? BIG_SPIN_SHORT : BIG_SPIN_LONG;
  demoKeypressTimerTable[SLOT_RND_C] = bigSpin;
}

/**
 * Reset demo playback state for a new demo run.
 */
export function resetDemoState(demo: DemoState): void {
  demo.active = true;
  demo.keypressIndex = 0;
  demo.keypressBitMask = 0x00;
  demo.keypressTimer = 0;
  demo.tickAccumulator = 0;
}

// ---------------------------------------------------------------------------
// Per-tick update
// ---------------------------------------------------------------------------

/**
 * Advance the demo keypress sequence. Called when the current
 * keypress timer expires.
 */
function demoModeNextKeypress(demo: DemoState): void {
  const index = demo.keypressIndex;

  // Bounds check — if we've gone past the end, signal demo should end
  if (index >= DEMO_SEQUENCE_LENGTH) {
    demo.active = false;
    return;
  }

  demo.keypressBitMask = DEMO_KEYPRESS_BIT_MASK_TABLE[index];
  demo.keypressTimer = demoKeypressTimerTable[index];
  demo.keypressIndex++;
}

/**
 * Called every frame with the real elapsed time. Uses a fixed-timestep
 * accumulator to decrement the keypress timer at the original 30ms
 * (3 centisecond) tick rate — matching the BBC Micro's tick_loop cadence.
 */
export function demoModeTick(demo: DemoState, dt: number): void {
  if (!demo.active) return;

  demo.tickAccumulator += Math.min(dt, 0.1);
  while (demo.tickAccumulator >= TICK_PERIOD_S) {
    demo.tickAccumulator -= TICK_PERIOD_S;

    demo.keypressTimer--;
    if (demo.keypressTimer < 0) {
      demoModeNextKeypress(demo);
      if (!demo.active) return;
    }
  }
}

/**
 * Get the current demo GameInput (reads from the demo bitmask).
 */
export function getDemoInput(demo: DemoState): GameInput {
  return gameInputFromDemoBitmask(demo.keypressBitMask);
}
