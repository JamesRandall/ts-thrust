# Thrust: Pod Attachment System — Implementation Reference

This document describes how the ship attaches to the pod (orb) in the original BBC Micro version of Thrust (6502 assembly by Jeremy C. Smith, 1986), covering the tractor beam activation sequence, distance thresholds, the attachment calculation, tractor beam line visuals, and pod stand visibility. It does NOT cover the physics of the attached pod (pendulum motion, midpoint system) — that is covered in a separate spec.

## Overview

The pod sits on a pod stand (object type $05, always object index 0 in the level's object list). When the player presses spacebar near the pod stand, the tractor beam activates. The system uses a two-phase approach: first the beam must be started while close, then attachment occurs when the ship moves further away (pulling the pod off the stand). A connecting line is drawn between ship and pod during the tractor phase and while attached.

## Key State Variables

| Variable | Description |
|---|---|
| `pod_attached_flag_1` | $00 = not attached, $FF = attached. Set during `attach_pod_to_ship`. Prevents fuel collection while set. |
| `pod_attached_flag_2` | $00 = pod visible on stand, $FF = pod detached/attached to ship. Controls pod stand sprite visibility. |
| `tractor_beam_started_flag` | $00 = inactive, $01 = beam started (ship is close). Must be $01 for attachment to proceed. |
| `pod_line_exists_flag` | Controls whether the tractor/attachment line is drawn. Mirrors `tractor_beam_started_flag` during tractor phase. |
| `shield_tractor_pressed` | Non-zero when spacebar is held this frame. |
| `pod_destroying_player_timer` | Must be negative (high bit set = $FF) for tractor to work — ensures player is alive. |
| `pod_sprite_plotted_flag` | Must be non-zero for tractor beam to be processed — pod must be on screen. |
| `level_reset_with_pod_flag` | Set to $FF on attachment. Used to determine level reset behaviour if the player dies with the pod. |

## Pod Stand (Object Index 0)

The pod stand is always the first object in the level (index 0). In `calculate_object_plot_addr`, when `current_object == 0`, the code captures the pod stand's world position into `nearest_obj` variables:

```
nearest_obj_xpos_FRAC = 0
nearest_obj_xpos_INT  = current_obj_xpos_INT - 2
nearest_obj_ypos_INT  = current_obj_ypos_INT
nearest_obj_ypos_INT_HI = current_obj_ypos_EXT
```

It also calculates the pod's screen-space position:

```
pod_window_ypos_INT  = (obj_vis_L0074 - window_scroll_y) * 2 - 5
pod_window_xpos_INT  = obj_vis_L0073 - 2 - window_scroll_x
pod_window_xpos_FRAC = $40
```

These screen coordinates are used for the distance check and line drawing.

### Pod Stand Visibility

In the object update loop, the pod stand's visibility is managed:

```
IF object_type == OBJECT_pod_stand:
    level_obj_flags[x] |= 0x02            // always make visible first
    IF pod_attached_flag_2 != 0:           // but if pod is detached...
        level_obj_flags[x] &= ~0x02       // ...hide the stand sprite
```

This means the pod stand (with pod sitting on it) is visible until the pod is attached, at which point the stand disappears — the pod is now drawn separately as the attached pod sprite.

## Tractor Beam Activation: `update_pod_tractor_beam`

This routine is called from the main object update loop. It implements the entry conditions and delegates to `do_pod_tractor_beam`.

### Entry Conditions

```
IF pod_sprite_plotted_flag == 0:
    // Pod not on screen — check object flags instead
    IF (level_obj_flags[0] & 0x03) != 0x03:
        return  // pod stand not fully visible
    // else fall through

IF pod_attached_flag_2 is negative ($FF):
    return  // pod already attached — nothing to do

IF shield_tractor_pressed == 0:
    tractor_beam_started_flag = 0  // reset beam — spacebar released
    return
```

If the pod is on screen (or its flags indicate visibility) AND spacebar is pressed AND the pod isn't already attached, proceed to `do_pod_tractor_beam`.

## Distance-Based Beam Logic: `do_pod_tractor_beam`

### Additional Check

```
IF pod_destroying_player_timer >= 0:
    return  // player is dying — no tractor beam
```

### Distance Calculation

`get_distance_ship_to_pod_tractor` computes an approximate Manhattan-style distance between the ship and pod in screen space:

```
dy = abs(ship_window_ypos_INT - pod_window_ypos_INT)
dx_raw = ship_window_xpos_INT - pod_window_xpos_INT  (with fractional component)

// X is scaled: shifted left 2 bits to account for MODE 1 pixel aspect ratio
dx = abs(dx_raw << 2)

// If dx overflows 8 bits during the shift, return max distance ($FF)

// Approximate distance using: d ≈ min + 3*max
// (where min = min(dx, dy), max = max(dx, dy))
IF dx < dy: swap dx and dy
distance = dy + dx + dx + dx  // = dy + 3*dx
IF any addition overflows: return $FF
```

This is a fast approximation of Euclidean distance weighted toward the larger axis. The X scaling compensates for the rectangular pixel aspect ratio in MODE 1.

### Distance Thresholds and State Transitions

The distance value (in accumulator A) drives a three-zone state machine:

```
distance = get_distance_ship_to_pod_tractor()

IF distance < $75 (117):
    // CLOSE ZONE — start the beam
    tractor_beam_started_flag = 1
    pod_line_exists_flag = 1
    return

IF distance >= $84 (132):
    // FAR ZONE — attach the pod (if beam was started)
    jump to attach_pod_to_ship

// MIDDLE ZONE ($75–$83) — dead zone, do nothing
return
```

This creates the core gameplay feel:

1. **Get close** (distance < $75): beam starts, line appears
2. **Pull away** (distance >= $84): pod detaches from stand and attaches to ship
3. **Dead zone** ($75–$83): prevents jitter at the boundary — you must clearly pull away

If spacebar is released at any point, `tractor_beam_started_flag` resets to 0, and `attach_pod_to_ship` will bail out even if distance >= $84 (it checks the flag first).

## Attachment: `attach_pod_to_ship`

### Guard Check

```
IF tractor_beam_started_flag == 0:
    return  // beam wasn't started — can't attach without approaching first
```

### Set Attachment Flags

```
pod_attached_flag_1 = $FF      // pod is now attached
pod_attached_flag_2 = $FF      // pod stand should be hidden
level_reset_with_pod_flag = $FF // remember pod was taken (for death/reset logic)
```

### Calculate Midpoint

The midpoint between ship and pod stand positions is calculated — this becomes the centre of the pendulum system:

```
midpoint_xpos = (player_xpos + nearest_obj_xpos) / 2
midpoint_ypos = (player_ypos + $80 + nearest_obj_ypos) / 2
// The $80 offset on Y biases the midpoint slightly downward
```

The division by 2 is done via ROR (rotate right through carry after the addition).

### Halve Force Vectors

The ship's current force/velocity vectors are halved at the moment of attachment:

```
force_vectorx = force_vectorx / 2  (arithmetic shift right, preserving sign)
force_vectory = force_vectory / 2
```

This prevents the pod attachment from launching the ship — the sudden addition of the pod's inertia is dampened.

### Calculate Initial Angle (Binary Search)

The code then determines the initial `angle_ship_to_pod` — the angle from the midpoint to the ship (and by extension, the opposite direction to the pod). This uses an iterative binary search over the 32-angle lookup table.

The algorithm runs for 7 iterations (`attach_pod_L007C` starts at 7), halving the search step each time:

```
// Target: find the angle whose lookup vector best matches the actual ship-to-midpoint offset
target_dx = (player_xpos_INT - midpoint_xpos_INT) << 2  // scaled, integer part
target_dy = (player_ypos_INT - midpoint_ypos_INT) << 1  // scaled, integer part

// Initial search parameters
step_angle_frac = $AB   // fractional part of angle step
step_angle_int  = $0A   // integer part: ~10.67 in the 32-angle space
iterations = 7

FOR each iteration:
    best_distance = $FF
    test_count = 3  // test 3 candidate angles per iteration

    FOR each test:
        candidate_vector = calculate_attached_pod_vector()  // get dx,dy for current angle
        candidate_dx = midpoint_deltax_INT << 2
        candidate_dy = midpoint_deltay_INT << 1

        error = approx_distance(candidate_dx - target_dx, candidate_dy - target_dy)

        IF error < best_distance:
            best_distance = error
            save current angle as best

        advance angle by (step_angle_int:step_angle_frac)

    // Restore best angle from this iteration
    // Halve the step size
    step = step / 2

    // Back up by one step from the best to centre the next search
    angle = best_angle - step

    IF iterations remaining > 0: continue
```

After 7 iterations, the binary search converges on the angle that best represents the ship's position relative to the midpoint. This angle is stored in `angle_ship_to_pod` (integer part, 0–31) and `angle_var_B_accumulate` (fractional part for smooth sub-angle precision).

### Calculate Initial Angular Velocity

After finding the angle, the code computes an initial angular velocity (`angle_var_B` / `angle_var_C`) based on the ship's current force vectors and the attachment angle. This ensures that if the ship was moving when it grabbed the pod, the pendulum starts swinging rather than stopping dead:

```
// Scale force vectors up by 16 (shift left 4)
scaled_force_x = force_vectorx << 4
scaled_force_y = force_vectory << 4

// Use attach_pod_calculate_UNKNOWN to combine with angle components
// (this routine multiplies/divides the force by the angle sine/cosine components)
angular_velocity = (scaled_force_y_component - scaled_force_x_component) / 4
```

The result is stored in `angle_var_B` (fractional) and `angle_var_C` (integer), representing the initial rate of angular change of the pendulum.

### Play Attachment Sound

```
collect_pod_fuel_sound()  // same 3-note jingle as fuel collection
```

## Tractor Beam Line Visual

### Drawing Conditions

The tractor/attachment line is drawn in `draw_new_line` when either:

- `pod_attached_flag_1 != 0` (pod is attached), OR
- `pod_line_exists_flag != 0` (tractor beam is active but not yet attached)

### Line Coordinates

Calculated in `calculate_line_coordinates`:

```
// Ship end (start of line)
line_start_y = ship_window_ypos_INT + $0A      // 10 pixels below ship centre
line_start_x = (ship_window_xpos_INT + $04) << 2  // shifted for pixel coords

// Pod end (end of line)
line_end_y = pod_window_ypos_INT + $0A          // 10 pixels below pod centre
line_end_x = (pod_window_xpos_INT + $04) << 2   // shifted for pixel coords
```

Both coordinates are stored in `old_draw_line_*` variables for XOR erasure on the next frame.

### Line Colour

The line uses `level_line_pixels_byte`, which is set during level initialisation:

```
level_line_pixels_byte = $F0 | invisible_landscape_flag
```

- On normal levels: `invisible_landscape_flag = $00`, so line colour = `$F0` = **colour 2 only** (the landscape colour — varies per level)
- On invisible landscape levels: `invisible_landscape_flag = $0F`, so line colour = `$FF` = **both colours** (white)

| Level | Landscape Colour | Line Appears As |
|---|---|---|
| 0 | Red ($01) | Red |
| 1 | Green ($02) | Green |
| 2 | Cyan ($06) | Cyan |
| 3 | Green ($02) | Green |
| 4 | Red ($01) | Red |
| 5 | Magenta ($05) | Magenta |
| Invisible levels | N/A | White ($FF) |

### Line Erasure

The line is XOR-rendered. `erase_old_line` redraws at the stored `old_draw_line_*` coordinates before the new line is drawn, controlled by `line_drawn_flag`.

## State Machine Summary

```
SPACEBAR NOT PRESSED
    tractor_beam_started_flag = 0
    pod_line_exists_flag = 0
    No line drawn, no tractor active
    |
    | [spacebar pressed, pod on screen, player alive]
    v
CALCULATE DISTANCE (ship to pod screen space)
    |
    |--- distance < $75 (close) --->  BEAM STARTED
    |                                  tractor_beam_started_flag = 1
    |                                  pod_line_exists_flag = 1
    |                                  Line drawn between ship and pod
    |                                  (still on stand)
    |
    |--- distance $75–$83 (dead zone) ---> NO CHANGE
    |                                       return, maintain current state
    |
    |--- distance >= $84 (far) AND tractor_beam_started_flag == 1 --->
    |
    v
ATTACH POD TO SHIP
    pod_attached_flag_1 = $FF
    pod_attached_flag_2 = $FF
    Pod stand hidden
    Midpoint calculated
    Force vectors halved
    Initial angle binary-searched
    Initial angular velocity computed
    Attachment sound plays
    Line continues to be drawn (now as attachment tether)
    |
    v
POD ATTACHED (handled by separate physics spec)
    Line drawn every frame between ship and pod positions
    Pod stand invisible
    Fuel collection blocked
```

## Constants Summary

```typescript
// Pod stand
const OBJECT_POD_STAND = 0x05;
const POD_STAND_OBJECT_INDEX = 0;  // always first object in level

// Distance thresholds
const TRACTOR_BEAM_START_DISTANCE = 0x75;   // 117 — must be closer than this to start beam
const TRACTOR_ATTACH_DISTANCE = 0x84;       // 132 — must be further than this to attach
// Dead zone: $75–$83 (117–131) prevents jitter

// Attachment
const ANGLE_SEARCH_ITERATIONS = 7;
const ANGLE_SEARCH_CANDIDATES_PER_ITERATION = 3;
const INITIAL_STEP_FRAC = 0xAB;
const INITIAL_STEP_INT = 0x0A;

// Line visual
const LINE_Y_OFFSET = 0x0A;       // 10 pixels below centre for both ship and pod
const LINE_X_OFFSET = 0x04;       // 4 units right, then shifted left 2 for pixel coords
const LINE_COLOUR_NORMAL = 0xF0;   // colour 2 (landscape colour)
const LINE_COLOUR_INVISIBLE = 0xFF; // both colours (white)

// Midpoint Y bias
const MIDPOINT_Y_BIAS = 0x80;     // added to player Y before averaging with pod Y
```

## Interaction with Other Systems

### Fuel Collection Blocked

While `pod_attached_flag_1 != 0`, the fuel proximity check in the object update loop bails out. The player cannot collect fuel while carrying the pod.

### Shield vs Tractor

The spacebar serves dual purpose — shield and tractor beam. In `update_shield_tractor_draw_ship_and_pod`, `shield_tractor_pressed` is set when spacebar is held. The shield visual (ship sprite replaced with shield sprite) activates based on `sheild_tractor_flag`, which additionally requires `vsync_count & 0x02` — making the shield flicker on alternate pairs of frames. The tractor beam check runs separately in the object update loop and uses the same `shield_tractor_pressed` flag.

### Death with Pod

If the player dies while `pod_attached_flag_1` is set, the `update_player_and_pod_states` routine handles the pod destruction sequence separately from the ship. `level_reset_with_pod_flag` ensures the level resets with the pod back on its stand if the player had taken it.

### Teleport with Pod

During teleportation (entering orbit), the pod attachment state is saved and restored around the teleport animation. `pod_line_exists_flag` and `pod_attached_flag_1` are pushed to the stack, zeroed for the animation, then restored.
