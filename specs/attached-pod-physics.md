# Thrust: Attached Pod Physics — Implementation Reference

This document describes the physics model for the ship-pod system once attached in the original BBC Micro version of Thrust (6502 assembly by Jeremy C. Smith, 1986). It covers the midpoint-based movement, pendulum angle simulation, thrust application, gravity, velocity damping, and position derivation. See the pod attachment spec for how the initial state is set up.

## Core Concept: Midpoint Physics

When the pod is attached, the game does NOT simulate the ship and pod independently. Instead:

- A **midpoint** between ship and pod is the primary physics body — all forces (gravity, thrust) act on it.
- An **angle** (`angle_ship_to_pod`) defines the orientation of the ship-pod axis.
- A **delta vector** (`midpoint_deltax/y`) is computed from the angle and determines the offset from midpoint to ship (and inversely, midpoint to pod).
- The ship position = midpoint + delta. The pod position = midpoint − delta.

This is effectively a rigid rod with the midpoint as the centre of mass.

## Update Order (per tick)

From the main `tick_loop`:

```
1. ship_input_thrust_calculate_force   — apply gravity + thrust to force vector, apply angular torque
2. midpoint_add_force_vector           — add force vector to midpoint position, add angular velocity to angle
3. calculate_attached_pod_vector       — compute delta vector from current angle
4. calculate_player_position_from_midpoint — derive ship position = midpoint + delta, compute velocity
5. calculate_pod_pos                   — derive pod position = midpoint − delta
```

## 1. Force Calculation: `ship_input_thrust_calculate_force`

### Gravity Application

Gravity is NOT applied every frame. It fires on specific ticks within each 16-frame cycle (`level_tick_counter & 0x0F`):

```
Gravity applied on ticks: 0, 3, 5, 8, 11, 13  (6 out of every 16 frames)
```

When applied:

```
force_vectory += gravity  (gravity_INT:gravity_FRAC)
```

Normal gravity: `gravity_INT = $00`, `gravity_FRAC` per level:

| Level | gravity_FRAC | Effective Gravity |
|---|---|---|
| 0 | $05 | lightest |
| 1 | $07 | |
| 2 | $09 | |
| 3 | $0B | |
| 4 | $0C | |
| 5 | $0D | heaviest |

Reverse gravity: `gravity_INT = $FF`, `gravity_FRAC = ~normal_FRAC` (ones complement).

### Guard Conditions

Force calculation only runs when the player is alive OR the pod is attached OR the ship is being destroyed. If none of these are true (ship not attached, not dying), force vectors are zeroed.

### Thrust

When SHIFT is held (and player alive, has fuel):

```
// Thrust division: 4 shifts normally, 5 shifts when pod attached
shift_count = pod_attached_flag_1 ? 5 : 4

thrust_y = -(angle_to_y[ship_angle] >> shift_count)  // negated — thrust opposes look direction
thrust_x = -(angle_to_x[ship_angle] >> shift_count)

force_vectory += thrust_y
force_vectorx += thrust_x
```

The extra right-shift when the pod is attached means **thrust is halved with the pod** — the ship+pod system is heavier.

The negation uses ones-complement-then-increment (`EOR #$FF, ADC #$01`), which gives the exact negative.

### Angular Torque (Pod Attached Only)

On gravity ticks OTHER than 3 and 11, if the pod is attached, thrust also applies angular torque to the pendulum:

```
// Calculate relative angle: ship_angle − angle_ship_to_pod
relative_angle = (ship_angle - angle_ship_to_pod + fractional_offset) & 0x1F

// Look up the perpendicular force component from the angle table
// This uses the same accumulation loop as calculate_attached_pod_vector
// with top_nibble_index = $0E (14 iterations)
torque = accumulated_angle_to_x[relative_angle] >> 1  (arithmetic shift right)

// Apply torque to angular velocity
angle_var_A += torque_frac
angle_var_B += torque_int
angle_var_C += sign_extend(torque_int)
```

Then angular damping is applied:

```
// Dampen angular velocity by subtracting velocity/64
damped = (angle_var_C:angle_var_B:angle_var_A) >> 6  (arithmetic shift right, 6 times)
angle_var_A -= damped_frac
angle_var_B -= damped_int
angle_var_C -= damped_sign
```

This creates the pendulum swing: thrust at an angle to the rod creates torque, which is damped over time.

### Linear Velocity Damping

At the end of force calculation, BOTH velocity components are damped:

```
// X damping: subtract velocity/64
damped_x = (force_vectorx_INT:FRAC:FRAC_LO) >> 6  (arithmetic shift right)
force_vectorx -= damped_x

// Y damping: subtract velocity/256
damped_y = (force_vectory_INT:FRAC) >> 8  (arithmetic shift right — actually just sign-extends)
force_vectory -= damped_y
```

Note the asymmetry: X damping is `/64` while Y damping is `/256`. X has stronger drag, which makes sense — horizontal motion has more resistance than vertical (gravity dominates vertical).

**Important**: This damping runs regardless of whether the pod is attached. It's the same for solo flight and attached flight.

## 2. Midpoint Update: `midpoint_add_force_vector`

Straightforward addition:

```
midpoint_xpos += force_vectorx  (3-byte: FRAC_LO, FRAC, INT)
midpoint_ypos += force_vectory  (3-byte: FRAC, INT, INT_HI — with sign extension for INT_HI)
```

### Angular Velocity Integration (Pod Attached Only)

If `pod_attached_flag_1 != 0` OR `pod_destroying_player_timer >= 0`:

```
angle_var_A_accumulate += angle_var_A  (fractional accumulator)
angle_var_B_accumulate += angle_var_B  (integer fraction)
angle_ship_to_pod += angle_var_C       (integer angle, masked to 0–31)
angle_ship_to_pod &= 0x1F
```

This advances the pendulum angle by the angular velocity each tick. The three-tier accumulation (`A` → `B_accumulate` → `ship_to_pod`) provides sub-angle precision — the angle changes smoothly rather than in whole-angle jumps.

## 3. Delta Vector: `calculate_attached_pod_vector`

Converts the current `angle_ship_to_pod` (with fractional part `angle_var_B_accumulate`) into a displacement vector from midpoint to ship.

### Algorithm

```
// Start with the base angle, offset by fractional part
effective_angle = angle_ship_to_pod + carry_from(angle_var_B_accumulate + $08)
effective_angle &= 0x1F

// Initialise delta from angle lookup
deltax = angle_to_x[effective_angle]
deltay = angle_to_y[effective_angle]

// Accumulate additional angle vectors based on top_nibble_index
// top_nibble_index starts at $0E (14) at attachment, decremented by 2 during death
FOR x = top_nibble_index down to 0:
    IF (pod_vector_L007A & 0xF0) == lookup_top_nibble[x]:
        effective_angle += 1  // sub-angle correction
        effective_angle &= 0x1F
    deltax += angle_to_x[effective_angle]
    deltay += angle_to_y[effective_angle]

// Divide by 4 (arithmetic shift right twice), preserving sign
deltax >>= 2  (signed)
deltay >>= 2  (signed)
```

The `top_nibble_index` controls the rod length — it determines how many angle vectors are accumulated, which effectively scales the delta magnitude. At the default value of $0E (14 iterations + initial = 15 lookups), the rod is at full length. During the death sequence, `top_nibble_index` is decremented by 2 each step, shortening the rod (the pod retracts toward the ship as it explodes).

The division by 4 at the end scales the accumulated vector to the appropriate displacement magnitude.

## 4. Ship Position: `calculate_player_position_from_midpoint`

```
// Ship = midpoint + delta
player_xpos = midpoint_xpos + midpoint_deltax
player_ypos = midpoint_ypos + midpoint_deltay  (with sign extension to INT_HI)

// Calculate velocity as position change
player_velocityx = new_player_xpos - old_player_xpos
player_velocityy = new_player_ypos - old_player_ypos

// Store old position, update to new
old_player_pos = player_pos
player_pos = new_player_pos
```

The velocity is derived from position change, not stored directly. This is used for bullet inheritance and collision response.

## 5. Pod Position: `calculate_pod_pos`

```
// Pod = midpoint − delta (opposite side of midpoint from ship)
pod_xpos_FRAC = midpoint_xpos_FRAC - midpoint_deltax_FRAC
pod_xpos_INT  = midpoint_xpos_INT  - midpoint_deltax_INT + 4  // +4 offset
pod_ypos      = midpoint_ypos      - midpoint_deltay           // with sign extension
pod_ypos     += 5                                               // +5 offset
```

The +4 (X) and +5 (Y) offsets account for the pod sprite's anchor point relative to its bounding box.

## Constants Summary

```typescript
// Gravity (applied 6 out of every 16 frames)
const GRAVITY_TICKS = [0, 3, 5, 8, 11, 13];  // within each 16-frame cycle
const GRAVITY_FRAC_PER_LEVEL = [0x05, 0x07, 0x09, 0x0B, 0x0C, 0x0D];
const GRAVITY_INT_NORMAL = 0x00;
const GRAVITY_INT_REVERSE = 0xFF;

// Thrust
const THRUST_SHIFT_SOLO = 4;       // divide angle lookup by 16
const THRUST_SHIFT_ATTACHED = 5;   // divide angle lookup by 32 (half thrust)

// Damping
const LINEAR_DAMPING_X_SHIFT = 6;  // subtract velocity/64
const LINEAR_DAMPING_Y_SHIFT = 8;  // subtract velocity/256
const ANGULAR_DAMPING_SHIFT = 6;   // subtract angular_velocity/64

// Angular torque (not applied on gravity ticks 3 and 11)
const TORQUE_SKIP_TICKS = [3, 11];
const TORQUE_ACCUMULATION_COUNT = 14;  // top_nibble_index initial value ($0E)
const TORQUE_SHIFT = 1;               // divide accumulated torque by 2

// Rod
const ROD_INITIAL_TOP_NIBBLE_INDEX = 0x0E;  // 14
const ROD_DELTA_DIVISOR = 4;                // shift right 2 after accumulation
const TOTAL_ANGLES = 32;                    // angle_ship_to_pod range 0–31

// Pod position offsets
const POD_X_OFFSET = 4;
const POD_Y_OFFSET = 5;
```
