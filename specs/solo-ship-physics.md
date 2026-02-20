# Thrust: Solo Ship Physics — Implementation Reference

This document describes the physics model for the ship flying WITHOUT the pod attached in the original BBC Micro version of Thrust (6502 assembly by Jeremy C. Smith, 1986). Use this to cross-reference your implementation.

## Critical Insight: Same Physics System

The solo ship uses the **same midpoint-based physics system** as the attached pod. The ship position is NOT updated directly — it is derived from the midpoint position plus a constant delta vector. The key differences from attached flight are:

- Force vectors are NOT zeroed (a common misreading of the guard code)
- Thrust is divided by 16 instead of 32
- Angular velocity is not updated (angle stays fixed)
- The angular torque section is skipped

## The Guard Code (Often Misunderstood)

```
ship_input_thrust_calculate_force:
    IF pod_destroying_player_timer < 0:    goto APPLY_FORCES   // player alive → always apply
    IF pod_attached_flag_1 != 0:           goto APPLY_FORCES   // pod attached → apply
    IF player_ship_destroyed_flag != 0:    goto APPLY_FORCES   // ship destroyed → apply
    // None of the above → zero forces and return
    force_vectorx = 0
    force_vectory = 0
    return
```

During normal alive gameplay, `pod_destroying_player_timer` is $FF (negative), so the first `BMI` **always branches to APPLY_FORCES**, regardless of pod attachment. The zeroing path only triggers during the brief death sequence when the timer is counting down, the pod isn't attached, and the ship hasn't been marked destroyed yet — a very narrow window.

## Update Order (per tick)

```
1. ship_input_rotate                       — handle rotation input
2. ship_input_thrust_calculate_force       — apply gravity + thrust, apply damping
3. midpoint_add_force_vector               — add force to midpoint position (skip angular update)
4. calculate_attached_pod_vector           — compute delta from angle (constant for solo)
5. calculate_player_position_from_midpoint — derive ship pos = midpoint + delta, compute velocity
```

## Rotation

Rotation is handled separately from the force system, on a simple timer:

```
IF (level_tick_counter & 0x03) == 0:
    return  // skip rotation on every 4th frame

IF caps_lock pressed:
    ship_angle -= 1  // rotate left
IF ctrl pressed:
    ship_angle += 1  // rotate right

ship_angle &= 0x1F  // wrap to 0–31
```

Rotation occurs on 3 out of every 4 frames (ticks where `level_tick_counter & 0x03 != 0`). This means the ship rotates at 75% of the frame rate.

## Gravity

Applied on specific ticks within each 16-frame cycle:

```
Gravity ticks: (level_tick_counter & 0x0F) == 0, 3, 5, 8, 11, or 13
```

That's **6 out of every 16 frames** (37.5% of frames).

```
force_vectory_FRAC += gravity_FRAC
force_vectory_INT  += gravity_INT + carry
```

### Gravity Values Per Level

Normal gravity: `gravity_INT = $00`

| Level | gravity_FRAC | Approx. acceleration per gravity tick |
|---|---|---|
| 0 | $05 | 0.020 |
| 1 | $07 | 0.027 |
| 2 | $09 | 0.035 |
| 3 | $0B | 0.043 |
| 4 | $0C | 0.047 |
| 5 | $0D | 0.051 |

Reverse gravity (after completing all 6 levels once): `gravity_INT = $FF`, `gravity_FRAC = ~normal` (ones complement). This pulls the ship upward instead of downward.

## Thrust

When SHIFT is held (player alive, has fuel, not out of fuel):

```
use_fuel()
run_engine()  // sound only

shift_count = 4  // solo flight uses 4 shifts (divide by 16)

// Calculate thrust vector from ship angle
thrust_y = angle_to_y[ship_angle]
FOR i = 1 to shift_count:
    thrust_y >>= 1  (arithmetic right shift, preserving sign)
thrust_y = -thrust_y  // negate: EOR #$FF, ADC #$01

thrust_x = angle_to_x[ship_angle]
FOR i = 1 to shift_count:
    thrust_x >>= 1  (arithmetic right shift, preserving sign)
thrust_x = -thrust_x  // negate

// Add to force vectors
force_vectorx += thrust_x  (3-byte addition: FRAC_LO, FRAC, INT)
force_vectory += thrust_y  (2-byte addition: FRAC, INT)
```

The thrust is the **negated, scaled angle lookup** — the angle tables point in the direction the ship faces, and thrust pushes in the opposite direction (ship nose points up, thrust pushes up against gravity).

### Thrust Timing

Thrust is only calculated on gravity ticks (the same 6/16 pattern). If it's not a gravity tick, the entire force calculation is skipped. So thrust and gravity are always applied together — you never get thrust without gravity on the same frame.

### Angular Torque: Skipped for Solo

After thrust is applied, the code checks `pod_attached_flag_1`. If zero (solo flight), it skips the angular torque calculation entirely and jumps to `end_of_thrust_force_calculation`. The torque code only runs when the pod is attached.

However, on gravity ticks 3 and 11, thrust is applied but the code jumps to `end_of_thrust_force_calculation` early regardless — even with the pod attached, torque is skipped on these ticks.

## Velocity Damping

Applied at the end of `ship_input_thrust_calculate_force`, **every gravity tick**, regardless of whether thrust was applied:

### X Damping (divide by 64)

```
// Arithmetic right shift force_vectorx by 6 bits
damped = (force_vectorx_INT : force_vectorx_FRAC : force_vectorx_FRAC_LO) >>> 6

// Subtract damped value from force vector
force_vectorx_FRAC_LO -= damped_FRAC_LO
force_vectorx_FRAC    -= damped_FRAC    (with borrow)
force_vectorx_INT     -= damped_INT     (with borrow)
```

### Y Damping (divide by 256)

```
// Arithmetic right shift force_vectory by 8 bits
// This is just sign-extending: shift (INT:FRAC) right 8, getting (sign:INT) as the subtracted value
damped_FRAC = force_vectory_FRAC
damped_INT  = force_vectory_INT
sign = (force_vectory_INT < 0) ? $FF : $00

// Shift right 8 times (arithmetic)
result = (sign : damped_INT : damped_FRAC) >>> 8
// which simplifies to: result_INT = sign, result_FRAC = force_vectory_INT, result_FRAC_LO ≈ force_vectory_FRAC

// Subtract
force_vectory_FRAC -= result_FRAC  (with borrow)
force_vectory_INT  -= result_INT   (with borrow)
// High byte subtraction handles sign extension
```

### Damping Asymmetry

X damping (`/64`) is **4x stronger** than Y damping (`/256`). This creates the characteristic feel:
- Horizontal momentum bleeds off relatively quickly
- Vertical momentum persists much longer (gravity dominates vertical dynamics)

This is the same damping for both solo and attached flight.

## Midpoint Position Update

```
midpoint_xpos += force_vectorx   (3-byte: FRAC_LO, FRAC, INT)
midpoint_ypos += force_vectory   (3-byte: FRAC, INT, INT_HI with sign extension)
```

### Angular Velocity Update: Skipped for Solo

The angular velocity integration (`angle_var_A/B/C → angle_var_B_accumulate → angle_ship_to_pod`) is skipped when `pod_attached_flag_1 == 0` and the player is alive. The angle remains at its initialised value (0 after level reset).

## Delta Vector (Constant for Solo)

`calculate_attached_pod_vector` still runs every frame, but since `angle_ship_to_pod` and `angle_var_B_accumulate` are both 0 (and never updated for solo flight), it computes the same delta every frame.

With angle 0, the lookup tables give a vector pointing straight up (negative Y). The accumulation loop runs `top_nibble_index` (14) times, building up this vector, then divides by 4. The result is a constant offset that places the ship above the midpoint.

This means the midpoint is effectively offset below the ship's visible position. For solo flight, you can think of it as the ship having an invisible "anchor point" slightly below it that follows the physics, with the ship rendered above.

## Ship Position Derivation

```
player_xpos = midpoint_xpos + midpoint_deltax
player_ypos = midpoint_ypos + midpoint_deltay (with sign extension to INT_HI)

// Velocity = position change from last frame
player_velocityx = new_player_xpos - old_player_xpos
player_velocityy = new_player_ypos - old_player_ypos

// Store and update
old_player_pos = current_player_pos
player_pos = new_player_pos
```

The velocity is derived from position change, not stored as a separate accumulator. This velocity is used for bullet inheritance when firing.

## Shield / Fuel Consumption

When spacebar is held (`shield_tractor_pressed`), fuel is consumed via `use_fuel` in `update_shield_tractor_draw_ship_and_pod`. The shield activation additionally requires `vsync_count & 0x02`, making the shield visual flicker on alternate pairs of frames. Shield fuel consumption is separate from thrust fuel consumption.

When SHIFT is held (thrust), `use_fuel` is called on each gravity tick.

## Summary of What Happens Each Frame

```
EVERY FRAME:
    ship_input_rotate()  // 3 out of 4 frames

ON GRAVITY TICKS (6 out of 16: ticks 0, 3, 5, 8, 11, 13):
    force_vectory += gravity
    IF shift_held AND alive AND has_fuel:
        force_vectorx += -angle_to_x[ship_angle] / 16
        force_vectory += -angle_to_y[ship_angle] / 16
    // damping (every gravity tick, even without thrust):
    force_vectorx -= force_vectorx / 64
    force_vectory -= force_vectory / 256

EVERY FRAME:
    midpoint_pos += force_vector
    // angular update skipped (solo)
    delta = calculate_from_angle(0)  // constant
    player_pos = midpoint_pos + delta
    player_velocity = player_pos - old_player_pos
```

## Constants Summary

```typescript
// Rotation
const ROTATION_SKIP_MASK = 0x03;     // skip when (tick & 0x03) == 0
const TOTAL_ANGLES = 32;             // ship_angle range 0–31

// Gravity timing
const GRAVITY_TICK_PATTERN = [0, 3, 5, 8, 11, 13];  // within 16-frame cycle
const GRAVITY_CYCLE_LENGTH = 16;

// Gravity values
const GRAVITY_INT_NORMAL = 0x00;
const GRAVITY_INT_REVERSE = 0xFF;
const GRAVITY_FRAC_PER_LEVEL = [0x05, 0x07, 0x09, 0x0B, 0x0C, 0x0D];

// Thrust
const THRUST_SHIFT_SOLO = 4;         // divide by 16

// Damping (per gravity tick)
const DAMPING_X_SHIFT = 6;           // subtract force/64
const DAMPING_Y_SHIFT = 8;           // subtract force/256

// Delta vector
const INITIAL_ANGLE = 0;             // angle_ship_to_pod at level start
const INITIAL_TOP_NIBBLE_INDEX = 0x0E;  // 14
```

## Common Implementation Mistakes

1. **Applying gravity every frame** — it's only 6 out of 16. This is the most likely cause of "feels off".
2. **Applying thrust independently of gravity** — thrust ONLY fires on gravity ticks. They always come as a pair.
3. **Applying damping every frame** — damping also only runs on gravity ticks.
4. **Zeroing force vectors for solo flight** — the guard code is easily misread. Force vectors persist between frames for solo flight.
5. **Using symmetric damping** — X damps 4x faster than Y. Getting this wrong makes horizontal movement feel too floaty or vertical movement too sticky.
6. **Forgetting the midpoint offset** — the ship position is not the physics position. There's a constant delta vector offset even for solo flight.
7. **Wrong rotation rate** — rotation skips every 4th frame, not every other frame.
