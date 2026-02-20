/**
 * ThrustPhysics.ts
 *
 * A frame-rate-independent physics model that reproduces the "feel" of
 * Thrust (BBC Micro, 1986) by Jeremy C. Smith.
 *
 * Derived from the Kieran Connell / Phill Harvey-Smith disassembly.
 *
 * The original runs at 50 Hz PAL with a fixed tick loop. Physics
 * updates are gated to 6 out of every 16 ticks (≈18.75 effective Hz).
 * This model accumulates real elapsed time and steps the simulation
 * at the original fixed-step rate, with leftover time carried forward,
 * so it feels identical regardless of host frame rate.
 *
 * All constants are taken directly from the 6502 source and converted
 * from Q7.8 / Q7.16 fixed-point into floating-point equivalents.
 * The angle system preserves the original 32-step rotation.
 *
 * ## Rotation
 *
 * The original skips rotation when (level_tick_counter & 0x03) == 0,
 * giving 3 out of every 4 ticks = 37.5 angle steps/second at 50 Hz.
 * Rotation always uses integer angle steps (0–31), never fractional.
 *
 * ## Pod attachment model
 *
 * When the pod is attached, the game switches to a midpoint-based
 * pendulum system. Physics forces are applied to the midpoint between
 * ship and pod, while a separate angular simulation determines where
 * each body sits relative to that midpoint. The ship and pod are
 * always diametrically opposite, separated by a tether whose length
 * is determined by accumulating angle vectors from a lookup table.
 *
 * The angular velocity is driven by thrust torque: when thrusting,
 * the offset between the ship's facing angle and the ship-to-pod
 * angle creates a tangential force that spins the system. This is
 * damped by subtracting (angularVel >> 6) each step — the same
 * pattern as the linear drag.
 *
 * The result is the distinctive swinging behaviour where the pod
 * hangs below and oscillates when you thrust off-axis.
 */

// ---------------------------------------------------------------------------
// Angle lookup tables — verbatim from the disassembly.
// 32 entries, index 0 = pointing up, 16 = pointing down, clockwise.
// Stored as signed Q7.8 fixed-point (INT + FRAC/256).
// ---------------------------------------------------------------------------

const ANGLE_TO_Y_INT = [
  0xFD, 0xFD, 0xFD, 0xFD, 0xFE, 0xFE, 0xFF, 0xFF,
  0x00, 0x00, 0x00, 0x01, 0x01, 0x02, 0x02, 0x02,
  0x02, 0x02, 0x02, 0x02, 0x01, 0x01, 0x00, 0x00,
  0x00, 0xFF, 0xFF, 0xFE, 0xFE, 0xFD, 0xFD, 0xFD,
];

const ANGLE_TO_Y_FRAC = [
  0x80, 0x8D, 0xB1, 0xEC, 0x3C, 0x9D, 0x0C, 0x84,
  0x00, 0x7C, 0xF4, 0x63, 0xC4, 0x14, 0x4F, 0x73,
  0x80, 0x73, 0x4F, 0x14, 0xC4, 0x63, 0xF4, 0x7C,
  0x00, 0x84, 0x0C, 0x9D, 0x3C, 0xEC, 0xB1, 0x8D,
];

const ANGLE_TO_X_INT = [
  0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFE, 0xFE, 0xFE,
  0xFE, 0xFE, 0xFE, 0xFE, 0xFF, 0xFF, 0xFF, 0xFF,
];

const ANGLE_TO_X_FRAC = [
  0x00, 0x3E, 0x7A, 0xB1, 0xE2, 0x0A, 0x27, 0x39,
  0x40, 0x39, 0x27, 0x0A, 0xE2, 0xB1, 0x7A, 0x3E,
  0x00, 0xC2, 0x86, 0x4F, 0x1E, 0xF6, 0xD9, 0xC7,
  0xC0, 0xC7, 0xD9, 0xF6, 0x1E, 0x4F, 0x86, 0xC2,
];

/** Convert the original signed Q7.8 pair to a float. */
function q78ToFloat(intByte: number, fracByte: number): number {
  const signed = intByte > 0x7F ? intByte - 256 : intByte;
  return signed + fracByte / 256;
}

// Pre-compute float angle tables (indexed 0..31)
export const ANGLE_Y = ANGLE_TO_Y_INT.map((v, i) => q78ToFloat(v, ANGLE_TO_Y_FRAC[i]));
export const ANGLE_X = ANGLE_TO_X_INT.map((v, i) => q78ToFloat(v, ANGLE_TO_X_FRAC[i]));

// ---------------------------------------------------------------------------
// Per-level gravity (fractional byte, INT is always 0)
// From level_gravity_FRAC_table: $05,$07,$09,$0B,$0C,$0D
// ---------------------------------------------------------------------------

const LEVEL_GRAVITY_FRAC = [0x05, 0x07, 0x09, 0x0B, 0x0C, 0x0D];

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------

/**
 * Original frame period: the tick loop waits for the BBC Micro system
 * clock (100 Hz) to reach 3 centiseconds before proceeding, giving
 * ~33.3 ticks/second — NOT 50 Hz as previously assumed.
 */
const ORIGINAL_FRAME_S = 3 / 100;

// ---------------------------------------------------------------------------
// Mass (shift counts from the disassembly)
// ---------------------------------------------------------------------------

/** Ship alone: thrust >> 4, effective mass divisor = 16 */
const MASS_SHIFT_SHIP = 4;

/** Ship + pod: thrust >> 5, effective mass divisor = 32 */
const MASS_SHIFT_SHIP_AND_POD = 5;

// ---------------------------------------------------------------------------
// Drag — applied each physics step.
//   X axis: force -= force >> 6  ->  *= 63/64
//   Y axis: force -= force >> 8  ->  *= 255/256
// ---------------------------------------------------------------------------

const DRAG_X_PER_STEP = 1 - 1 / 64;
const DRAG_Y_PER_STEP = 1 - 1 / 256;

// ---------------------------------------------------------------------------
// Angular drag — applied each physics step when pod attached.
//   angularVel -= angularVel >> 6  ->  *= 63/64
// ---------------------------------------------------------------------------

const ANGULAR_DRAG_PER_STEP = 1 - 1 / 64;

// ---------------------------------------------------------------------------
// Tether / pendulum constants
// ---------------------------------------------------------------------------

/**
 * top_nibble_index is initialised to $0E (14) and determines the
 * tether length. With index=14: 16 samples / 4 = effective tether
 * of 4 unit-vectors.
 */
const TETHER_TOP_NIBBLE_INDEX = 14;

/**
 * lookup_top_nibble table from the original — 15 entries ($10..$F0).
 * Used during tether delta accumulation to conditionally advance the
 * angle index, creating an elliptical tether path.
 */
const LOOKUP_TOP_NIBBLE = [
  0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80,
  0x90, 0xA0, 0xB0, 0xC0, 0xD0, 0xE0, 0xF0,
];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ThrustInput {
  /** True while the thrust key is held */
  thrust: boolean;
  /** Rotation request: -1 = anticlockwise, 0 = none, +1 = clockwise */
  rotate: -1 | 0 | 1;
  /** True if shield/tractor beam key is held */
  shield: boolean;
}

export interface PodState {
  /** Pod position in world units (derived from midpoint - delta) */
  x: number;
  y: number;
  /** Angle from midpoint to ship, in the 32-step system. */
  angleShipToPod: number;
  /** Sub-step fractional accumulator for the angle. */
  angleFrac: number;
  /** Angular velocity of the pendulum system. */
  angularVelocity: number;
  /** Current tether length index (top_nibble_index). */
  tetherIndex: number;
}

export interface ThrustState {
  /** Position of the ship (or midpoint when pod attached) in world units */
  x: number;
  y: number;
  /** Velocity in world units / physics step */
  vx: number;
  vy: number;
  /** Current angle index (0-31), always integer */
  angle: number;
  /** Accumulated force vector */
  forceX: number;
  forceY: number;

  /** True when the pod is attached to the ship */
  podAttached: boolean;
  /** Pod physics state */
  pod: PodState;

  /** Ship world position (equals x,y when no pod; offset from midpoint when attached) */
  shipX: number;
  shipY: number;
  /** Pod world position (only valid when podAttached) */
  podX: number;
  podY: number;

  /** Current level (0-based, 0-5) — controls gravity */
  level: number;
}

// ---------------------------------------------------------------------------
// The physics model
// ---------------------------------------------------------------------------

export class ThrustPhysics {
  public state: ThrustState;

  /** Leftover time from previous frame, carried into the next */
  private accumulator = 0;

  /** Internal tick counter, replicates level_tick_counter */
  private tickCounter = 0;

  /** The 6 active physics slots per 16-tick window */
  private static readonly ACTIVE_SLOTS = new Set([0, 3, 5, 8, 11, 13]);

  /**
   * Of those 6 active slots, the torque calculation is skipped on
   * slots 3 and 11. Torque fires on 4 of every 16 ticks.
   */
  private static readonly TORQUE_SKIP_SLOTS = new Set([3, 11]);

  constructor(initialState?: Partial<ThrustState>) {
    this.state = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      angle: 0,
      forceX: 0,
      forceY: 0,
      podAttached: false,
      pod: {
        angleShipToPod: 0,
        angleFrac: 0,
        angularVelocity: 0,
        tetherIndex: TETHER_TOP_NIBBLE_INDEX,
        x: 0,
        y: 0,
      },
      shipX: 0,
      shipY: 0,
      podX: 0,
      podY: 0,
      level: 0,
      ...initialState,
    };
  }

  // -----------------------------------------------------------------------
  // Derived properties
  // -----------------------------------------------------------------------

  private get gravity(): number {
    const idx = Math.min(this.state.level, LEVEL_GRAVITY_FRAC.length - 1);
    return LEVEL_GRAVITY_FRAC[idx] / 256;
  }

  private get massShift(): number {
    return this.state.podAttached ? MASS_SHIFT_SHIP_AND_POD : MASS_SHIFT_SHIP;
  }

  /** Ship angle in radians (0 = up, clockwise positive). */
  get angleRadians(): number {
    return (this.state.angle / 32) * Math.PI * 2;
  }

  // -----------------------------------------------------------------------
  // Main update
  // -----------------------------------------------------------------------

  update(dtSeconds: number, input: ThrustInput): void {
    const dt = Math.min(dtSeconds, 0.1);

    this.accumulator += dt;
    while (this.accumulator >= ORIGINAL_FRAME_S) {
      this.accumulator -= ORIGINAL_FRAME_S;
      this.tickStep(input);
    }

    // Re-derive positions every frame for smooth rendering
    this.derivePositions();
  }

  // -----------------------------------------------------------------------
  // Internal — per-tick step
  // -----------------------------------------------------------------------

  private tickStep(input: ThrustInput): void {
    const slot = this.tickCounter & 0x0F;
    this.tickCounter = (this.tickCounter + 1) & 0xFF;

    const s = this.state;

    // --- Rotation: 3 out of every 4 ticks, integer steps only ---
    if ((slot & 0x03) !== 0 && input.rotate !== 0) {
      s.angle = ((s.angle + input.rotate) + 32) % 32;
    }

    const isActiveSlot = ThrustPhysics.ACTIVE_SLOTS.has(slot);

    // --- Step 1: Force calculation (active slots only — 6 of every 16 ticks) ---
    if (isActiveSlot) {
      const angleIdx = s.angle & 0x1F;

      // Gravity
      s.forceY += this.gravity;

      // Thrust
      if (input.thrust) {
        const thrustY = ANGLE_Y[angleIdx] / (1 << this.massShift);
        const thrustX = ANGLE_X[angleIdx] / (1 << this.massShift);
        s.forceY += thrustY;
        s.forceX += thrustX;
      }

      // Torque (pod attached + thrusting + not a skip slot)
      if (s.podAttached && input.thrust && !ThrustPhysics.TORQUE_SKIP_SLOTS.has(slot)) {
        this.applyThrustTorque(angleIdx);
      }

      // Angular damping (active slots only, per spec)
      if (s.podAttached) {
        s.pod.angularVelocity *= ANGULAR_DRAG_PER_STEP;
      }

      // Linear drag
      s.forceX *= DRAG_X_PER_STEP;
      s.forceY *= DRAG_Y_PER_STEP;
    }

    // --- Step 2: Position integration (every tick, both solo and attached) ---
    s.vx = s.forceX;
    s.vy = s.forceY;
    s.x += s.forceX;
    s.y += s.forceY;

    // Angular velocity integration (every tick, pod attached only)
    if (s.podAttached) {
      this.integrateAngularVelocity();
    }

    // --- Step 3: Derive ship/pod positions (every tick) ---
    this.derivePositions();
  }

  // -----------------------------------------------------------------------
  // Torque
  // -----------------------------------------------------------------------

  private applyThrustTorque(angleIdx: number): void {
    const pod = this.state.pod;
    const diffAngle = ((angleIdx - Math.round(pod.angleShipToPod)) & 0x1F);
    const tangentialForce = ANGLE_X[diffAngle] * 8;
    pod.angularVelocity += tangentialForce / 2;
  }

  // -----------------------------------------------------------------------
  // Angular velocity integration
  // -----------------------------------------------------------------------

  private integrateAngularVelocity(): void {
    const pod = this.state.pod;

    pod.angleFrac += pod.angularVelocity;

    while (pod.angleFrac >= 256) {
      pod.angleFrac -= 256;
      pod.angleShipToPod = (pod.angleShipToPod + 1) & 0x1F;
    }
    while (pod.angleFrac < 0) {
      pod.angleFrac += 256;
      pod.angleShipToPod = (pod.angleShipToPod - 1 + 32) & 0x1F;
    }
  }

  // -----------------------------------------------------------------------
  // Tether delta — calculate_attached_pod_vector
  // -----------------------------------------------------------------------

  private calculateTetherDelta(): { dx: number; dy: number } {
    const pod = this.state.pod;

    // Replicate calculate_attached_pod_vector from the 6502 source.
    //
    // The original adds 8 to angle_var_B_accumulate (our angleFrac) as a
    // rounding bias, with carry propagating into angle_ship_to_pod.
    const fracPlusEight = pod.angleFrac + 8;
    const carry = fracPlusEight > 0xFF ? 1 : 0;
    const topNibble = fracPlusEight & 0xF0;
    let y = (pod.angleShipToPod + carry) & 0x1F;

    // Start accumulator with the first sample at angle index y
    let dxAcc = ANGLE_X[y];
    let dyAcc = ANGLE_Y[y];

    // Loop from top_nibble_index down to 0 (inclusive), accumulating
    // angle table entries. The angle index Y only advances when the
    // top nibble of the fractional accumulator matches the lookup table
    // entry — this creates the elliptical tether shape.
    for (let x = pod.tetherIndex; x >= 0; x--) {
      if (topNibble === LOOKUP_TOP_NIBBLE[x]) {
        y = (y + 1) & 0x1F;
      }
      dxAcc += ANGLE_X[y];
      dyAcc += ANGLE_Y[y];
    }

    // Arithmetic shift right by 2 (sign-preserving divide by 4)
    return { dx: dxAcc / 4, dy: dyAcc / 4 };
  }

  // -----------------------------------------------------------------------
  // Derive ship/pod world positions from midpoint + tether
  // -----------------------------------------------------------------------

  private derivePositions(): void {
    const s = this.state;

    if (!s.podAttached) {
      s.shipX = s.x;
      s.shipY = s.y;
      s.podX = s.x;
      s.podY = s.y;
      return;
    }

    const { dx, dy } = this.calculateTetherDelta();
    s.shipX = s.x + dx;
    s.shipY = s.y + dy;
    s.podX = s.x - dx;
    s.podY = s.y - dy;
  }

  // -----------------------------------------------------------------------
  // Pod attachment
  // -----------------------------------------------------------------------

  attachPod(podWorldX: number, podWorldY: number): void {
    const s = this.state;

    // Compute the actual midpoint (used as the search target)
    const actualMidX = (s.shipX + podWorldX) / 2;
    const actualMidY = (s.shipY + podWorldY) / 2;
    const targetDx = s.shipX - actualMidX;
    const targetDy = s.shipY - actualMidY;

    // Set up pod state before searching
    s.pod.tetherIndex = TETHER_TOP_NIBBLE_INDEX;
    s.podAttached = true;

    // Binary search for the angle whose tether delta direction best
    // matches the ship-to-pod axis — replicates the 7-pass iterative
    // search in the 6502 source.
    s.pod.angleShipToPod = 0;
    s.pod.angleFrac = 0;

    let stepHi = 0x0A;
    let stepLo = 0xAB;

    for (let pass = 0; pass < 7; pass++) {
      let bestDist = Infinity;
      let bestAngle = s.pod.angleShipToPod;
      let bestFrac = s.pod.angleFrac;

      for (let i = 0; i < 3; i++) {
        const { dx, dy } = this.calculateTetherDelta();
        const dist = Math.abs(dx - targetDx) + Math.abs(dy - targetDy);

        if (dist < bestDist) {
          bestDist = dist;
          bestAngle = s.pod.angleShipToPod;
          bestFrac = s.pod.angleFrac;
        }

        const newFrac = s.pod.angleFrac + stepLo;
        const carry = newFrac >= 256 ? 1 : 0;
        s.pod.angleFrac = newFrac & 0xFF;
        s.pod.angleShipToPod = (s.pod.angleShipToPod + stepHi + carry) & 0x1F;
      }

      s.pod.angleShipToPod = bestAngle;
      s.pod.angleFrac = bestFrac;

      const combined = (stepHi << 8) | stepLo;
      const halved = combined >> 1;
      stepHi = (halved >> 8) & 0xFF;
      stepLo = halved & 0xFF;

      const newFrac = s.pod.angleFrac - stepLo;
      if (newFrac < 0) {
        s.pod.angleFrac = (newFrac + 256) & 0xFF;
        s.pod.angleShipToPod = (s.pod.angleShipToPod - stepHi - 1) & 0x1F;
      } else {
        s.pod.angleFrac = newFrac & 0xFF;
        s.pod.angleShipToPod = (s.pod.angleShipToPod - stepHi) & 0x1F;
      }
    }

    // Now we have the best angle. The tether half-length varies by angle
    // (5–10 units), so placing midpoint at (ship+pod)/2 causes a snap
    // when the tether length doesn't match the actual distance.
    //
    // Instead, anchor the ship at its current position:
    //   ship = midpoint + delta  =>  midpoint = ship - delta
    const { dx, dy } = this.calculateTetherDelta();
    s.x = s.shipX - dx;
    s.y = s.shipY - dy;

    // Halve forces (arithmetic shift right — matches original)
    s.forceX /= 2;
    s.forceY /= 2;
    s.pod.angularVelocity = 0;

    this.derivePositions();
  }

  /** Detach the pod. Ship keeps current velocity. */
  detachPod(): void {
    const s = this.state;
    if (!s.podAttached) return;
    s.x = s.shipX;
    s.y = s.shipY;
    s.podAttached = false;
    s.pod.angularVelocity = 0;
    s.pod.angleFrac = 0;
    this.derivePositions();
  }

  // -----------------------------------------------------------------------
  // Utilities
  // -----------------------------------------------------------------------

  /** Reset all motion, keeping position and level. */
  resetMotion(): void {
    this.state.vx = 0;
    this.state.vy = 0;
    this.state.forceX = 0;
    this.state.forceY = 0;
    this.state.pod.angularVelocity = 0;
    this.state.pod.angleFrac = 0;
    this.accumulator = 0;
  }

  /** Set the level (0-5), which controls gravity strength. */
  setLevel(level: number): void {
    this.state.level = Math.max(0, Math.min(5, level));
  }
}