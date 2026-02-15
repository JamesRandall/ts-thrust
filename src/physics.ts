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
    // INT bytes above 0x7F are negative (two's complement)
    const signed = intByte > 0x7F ? intByte - 256 : intByte;
    return signed + fracByte / 256;
}

// Pre-compute float angle tables (indexed 0..31)
const ANGLE_Y = ANGLE_TO_Y_INT.map((v, i) => q78ToFloat(v, ANGLE_TO_Y_FRAC[i]));
const ANGLE_X = ANGLE_TO_X_INT.map((v, i) => q78ToFloat(v, ANGLE_TO_X_FRAC[i]));

// ---------------------------------------------------------------------------
// Per-level gravity (fractional byte, INT is always 0)
// From level_gravity_FRAC_table: $05,$07,$09,$0B,$0C,$0D
// ---------------------------------------------------------------------------

const LEVEL_GRAVITY_FRAC = [0x05, 0x07, 0x09, 0x0B, 0x0C, 0x0D];

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------

/** Original frame period: 50 Hz PAL */
const ORIGINAL_FRAME_S = 1 / 50;

/**
 * The tick loop runs every frame, but physics only updates on 6 of every
 * 16 ticks (tick_counter AND $0F matching 0, 3, 5, 8, 11, 13).
 * Effective physics rate = 50 * (6/16) = 18.75 Hz.
 */
const PHYSICS_STEPS_PER_16_TICKS = 6;
const PHYSICS_STEP_S = (ORIGINAL_FRAME_S * 16) / PHYSICS_STEPS_PER_16_TICKS;

// ---------------------------------------------------------------------------
// Mass (shift counts from the disassembly)
// ---------------------------------------------------------------------------

/** Ship alone: thrust >> 4, so effective mass divisor = 16 */
const MASS_SHIFT_SHIP = 4;

/** Ship + pod: thrust >> 5, so effective mass divisor = 32 */
const MASS_SHIFT_SHIP_AND_POD = 5;

// ---------------------------------------------------------------------------
// Drag — the original subtracts (force >> N) from force each physics step.
//   X axis: shift 6  → damping = 1 - 1/64  = 0.984375
//   Y axis: shift 8  → damping = 1 - 1/256 = 0.99609375
// These are per-physics-step multipliers.
// ---------------------------------------------------------------------------

const DRAG_X_PER_STEP = 1 - 1 / 64;
const DRAG_Y_PER_STEP = 1 - 1 / 256;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ThrustInput {
    /** True while the thrust key is held */
    thrust: boolean;
    /** Rotation request: -1 = anticlockwise, 0 = none, +1 = clockwise */
    rotate: -1 | 0 | 1;
    /** True if shield/tractor beam key is held (not modelled here but reserved) */
    shield: boolean;
}

export interface ThrustState {
    /** Ship position in world units */
    x: number;
    y: number;
    /** Ship velocity in world units / second */
    vx: number;
    vy: number;
    /** Current angle index (0–31, 0 = up, 8 = right, 16 = down, 24 = left) */
    angle: number;
    /** True when the pod is attached to the ship */
    podAttached: boolean;
    /** Current level (0-based, 0–5) — controls gravity */
    level: number;
    /** Accumulated force vector (internal, but exposed for debug/HUD) */
    forceX: number;
    forceY: number;
}

// ---------------------------------------------------------------------------
// The physics model
// ---------------------------------------------------------------------------

export class Physics {
    public state: ThrustState;

    /** Leftover time from previous frame, carried into the next */
    private accumulator = 0;

    /** Internal tick counter, replicates level_tick_counter & 0x0F */
    private tickCounter = 0;

    /**
     * The original checks specific tick slots (0,3,5,8,11,13) within a
     * 16-tick window. We replicate that gating exactly.
     */
    private static readonly ACTIVE_SLOTS = new Set([0, 3, 5, 8, 11, 13]);

    /**
     * Rotation rate: the original increments/decrements ship_angle once per
     * tick-loop call (50 Hz), giving ~1.6 full rotations per second.
     * We accumulate fractional rotation at the same rate.
     */
    private static readonly ROTATION_RATE = 50; // angle-steps per second

    constructor(initialState?: Partial<ThrustState>) {
        this.state = {
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            angle: 0,
            podAttached: false,
            level: 0,
            forceX: 0,
            forceY: 0,
            ...initialState,
        };
    }

    /** Gravity for the current level, in world units per physics step. */
    private get gravity(): number {
        const idx = Math.min(this.state.level, LEVEL_GRAVITY_FRAC.length - 1);
        return LEVEL_GRAVITY_FRAC[idx] / 256;
    }

    /** Current mass shift count based on pod attachment. */
    private get massShift(): number {
        return this.state.podAttached ? MASS_SHIFT_SHIP_AND_POD : MASS_SHIFT_SHIP;
    }

    /**
     * Call once per frame with the time since the last frame (in seconds)
     * and the current input state. Internally steps the simulation at the
     * original fixed rate so the feel is frame-rate independent.
     */
    update(dtSeconds: number, input: ThrustInput): void {
        // Cap delta to avoid spiral-of-death on long frames (e.g. tab-away)
        const dt = Math.min(dtSeconds, 0.1);

        // --- Rotation is per-tick (50 Hz), not gated to physics slots ---
        this.applyRotation(dt, input.rotate);

        // --- Physics stepping at the original gated rate ---
        this.accumulator += dt;

        while (this.accumulator >= ORIGINAL_FRAME_S) {
            this.accumulator -= ORIGINAL_FRAME_S;
            this.tickStep(input);
        }
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    /** Smooth rotation accumulated at 50 Hz equivalent rate. */
    private applyRotation(dt: number, rotate: -1 | 0 | 1): void {
        if (rotate === 0) return;
        const angleDelta = rotate * Physics.ROTATION_RATE * dt;
        this.state.angle = ((this.state.angle + angleDelta) % 32 + 32) % 32;
    }

    /**
     * One tick of the original game loop.
     * Physics only fires on the 6 active slots per 16-tick window.
     */
    private tickStep(input: ThrustInput): void {
        const slot = this.tickCounter & 0x0F;
        this.tickCounter = (this.tickCounter + 1) & 0xFF;

        if (!Physics.ACTIVE_SLOTS.has(slot)) return;

        // --- Gravity (always applied on active slots) ---
        this.state.forceY += this.gravity;

        // --- Thrust (only when key held and fuel available) ---
        if (input.thrust) {
            // Resolve angle to the nearest integer index for table lookup,
            // matching the original's discrete 32-step system.
            const angleIdx = Math.round(this.state.angle) & 0x1F;

            // Thrust vector from lookup table, divided by mass (right-shift)
            const thrustY = ANGLE_Y[angleIdx] / (1 << this.massShift);
            const thrustX = ANGLE_X[angleIdx] / (1 << this.massShift);

            this.state.forceY += thrustY;
            this.state.forceX += thrustX;
        }

        // --- Drag (applied every active physics step) ---
        // Original: force = force - (force >> N)
        // Equivalent to: force *= (1 - 1/2^N)
        this.state.forceX *= DRAG_X_PER_STEP;
        this.state.forceY *= DRAG_Y_PER_STEP;

        // --- Integrate force into position ---
        // In the original, force_vector IS the velocity (it accumulates
        // thrust and gravity then has drag applied — classic Euler integration
        // where the "force" variable is really velocity with built-in damping).
        this.state.vx = this.state.forceX;
        this.state.vy = this.state.forceY;

        this.state.x += this.state.forceX;
        this.state.y += this.state.forceY;
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Ship angle in radians (0 = up, clockwise positive). */
    get angleRadians(): number {
        return (this.state.angle / 32) * Math.PI * 2;
    }

    /** Ship angle in degrees. */
    get angleDegrees(): number {
        return (this.state.angle / 32) * 360;
    }

    /** Reset all motion, keeping position and level. */
    resetMotion(): void {
        this.state.vx = 0;
        this.state.vy = 0;
        this.state.forceX = 0;
        this.state.forceY = 0;
        this.accumulator = 0;
    }

    /** Attach or detach the pod (doubles effective mass when attached). */
    setPodAttached(attached: boolean): void {
        this.state.podAttached = attached;
    }

    /** Set the level (0–5), which controls gravity strength. */
    setLevel(level: number): void {
        this.state.level = Math.max(0, Math.min(5, level));
    }
}