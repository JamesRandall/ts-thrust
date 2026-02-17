# Thrust: Fuel Collection System — Implementation Reference

This document describes the fuel collection ("fuel suck") mechanic in the original BBC Micro version of Thrust (6502 assembly by Jeremy C. Smith, 1986), covering proximity detection, the tractor counter, fuel addition, beam visuals, and edge cases. Use this as a specification for the TypeScript reimplementation.

## Overview

When the player hovers near a fuel canister and holds the shield/tractor beam button (spacebar), a tractor beam activates that gradually drains the canister into the ship's fuel supply. After 26 ticks of cumulative beam contact, the canister is consumed. The beam is visualised as two flickering yellow lines forming a V-shape from ship to fuel pod.

## Fuel Object Properties

| Property | Value |
|---|---|
| Object type | `OBJECT_fuel` ($04) |
| Width | 4 |
| Height | 10 ($0A) |
| Score on consumption | $30 (BCD — 300 points) |
| Explosion particle type | $01 (debris) — used if shot, not during collection |

## Proximity Detection

Detection runs in the object update loop when processing a fuel object. All of the following conditions must be true simultaneously:

```
pod_destroying_player_timer < 0        // player alive, not in death sequence (high bit set)
pod_attached_flag_1 == 0               // pod is NOT attached to ship
object_type == OBJECT_fuel             // current object is a fuel canister
shield_tractor_pressed != 0            // spacebar is held down
```

Then the spatial checks:

```
x_distance = current_obj_xpos_INT - player_xpos_INT
x_distance != 0                        // must not be exactly overlapping
x_distance < 6                         // within 6 units horizontally

y_distance = current_obj_ypos_INT - player_ypos_INT  (with high byte comparison)
high_byte_difference == 0              // must be on same vertical page
y_distance < $1C (28)                  // within 28 units vertically
```

The pickup zone is approximately 6 units wide (excluding zero) and 28 units tall, measured from player position to fuel object position. Note: the X check uses unsigned comparison after subtraction, so the player must be to the left of or at the fuel object (the subtraction must not underflow past zero before the non-zero check).

## Collection Process

### Per-Frame: Set Flag and Increment Counter

When all proximity conditions are met:

```
collecting_fuel_flag = 1
obj_tractor_counter[current_object] += 1
```

Each fuel object has its own entry in the `obj_tractor_counter` table (12 entries, initialised to 0 at level start). This tracks cumulative beam contact time for that specific canister.

### Consumption at 26 Ticks

When `obj_tractor_counter[current_object]` reaches $1A (26):

1. **Remove from rendering**: `level_obj_flags[current_object] &= ~0x02`
2. **Award score**: `accumulate_score_A($30)` — 300 points in BCD
3. **Play collection sound**: Three-part jingle via `collect_pod_fuel_sound` (calls `sound_params_collect_1`, `sound_params_collect_2`, `sound_params_collect_1`)

### Counter Persistence

The tractor counter does NOT reset if the player drifts out of range or releases spacebar. Progress is preserved per-canister. The player can collect in multiple passes, hovering briefly each time, and the counter accumulates across all contact frames.

## Fuel Addition

Separately from the tractor counter, the `tick_fuel_pickup_draw_beams` routine handles actual fuel increase. Each frame that `collecting_fuel_flag` is set:

```
add_fuel():
    IF demo_mode_flag != 0: return  // no fuel in demo mode
    fuel_A += $11  (BCD addition)
    fuel_B += $00  (with carry)
    fuel_C += $00  (with carry)
    fuel_value_updated_flag = 0     // triggers status bar redraw
```

This adds 11 BCD fuel units per frame. The fuel display on the status bar is refreshed when `fuel_value_updated_flag` is cleared.

Note: fuel addition happens every frame the beam is active, independent of the 26-tick consumption counter. The player gains fuel continuously while hovering, and the canister is removed as a bonus once 26 ticks accumulate.

## Beam Visuals

### Draw Timing

The beam visual only renders on **alternate frames**:

```
IF (level_tick_counter >> 1) has carry (i.e. odd frames): skip drawing
```

This produces a flickering/pulsing effect. Fuel addition still happens every frame — only the visual flickers.

### Beam Erasure

The beam is XOR-rendered, so it erases by redrawing at the same position. At the start of `tick_fuel_pickup_draw_beams`:

```
IF fuel_beam_position_flag != 0:
    // Erase previous beam by redrawing at stored coordinates
    draw_beams(fuel_beam_start_x, fuel_beam_start_y)
    fuel_beam_position_flag = 0
```

### Beam Origin Calculation

The beam start point is derived from the ship's screen-space position:

```
beam_start_y = ship_window_ypos_INT + $14       // 20 pixels below ship centre
beam_start_x = (ship_window_xpos_INT + $04)     // offset 4, then...
               // ...shifted left twice via ROL through xpos_FRAC
               // converts from character coordinates to pixel coordinates
```

These are stored in `fuel_beam_start_x` and `fuel_beam_start_y` for next-frame erasure, and `fuel_beam_position_flag` is set to 1.

### Drawing the Two Beam Lines

The `draw_beams` subroutine draws two lines using the standard Bresenham `draw_line` routine, both with `plot_line_pixels_byte = $0F` (colour 1 — yellow/ship colour on all levels).

**Line 1 (left beam):**

```
draw_line_start_x = beam_x
draw_line_end_x   = beam_x + $0A             // 10 pixels to the right
draw_line_start_y = beam_y + $1E             // 30 pixels below (bottom — fuel end)
draw_line_end_y   = beam_y                   // top (ship end)
```

This draws a diagonal line from lower-left to upper-right.

**Line 2 (right beam):**

After line 1 completes, the coordinates are adjusted:

```
draw_line_end_x   = line1_end_x + $0C        // 12 pixels right of line 1's right end
draw_line_start_x = draw_line_end_x + $08    // 8 more pixels right
// start_y and end_y reuse line 1's values (beam_y and beam_y + $1E)
```

This draws a second diagonal line, offset to the right, forming the other side of the V/funnel shape.

### Visual Summary

```
        Ship
         |
    Line1  Line2
      \      /
       \    /
        \  /
         \/
      Fuel Pod

(Both lines drawn in yellow, flickering on alternate frames)
```

The two lines splay outward from near the ship downward toward the fuel canister, creating a funnel or tractor beam visual. The yellow colour (colour 1) is consistent across all levels since it's the ship colour channel.

## State Flow

```
EACH FRAME (in update_and_draw_all_objects):
    collecting_fuel_flag = 0  // reset at start of object loop

    FOR each object:
        IF object is fuel AND proximity conditions met:
            collecting_fuel_flag = 1
            obj_tractor_counter[object] += 1
            IF counter >= 26:
                consume canister (remove, score, sound)

EACH FRAME (in tick_fuel_pickup_draw_beams):
    IF fuel_beam_position_flag:
        erase previous beam (XOR redraw)

    IF collecting_fuel_flag == 0: return

    add_fuel()  // +11 BCD units

    IF odd frame: return  // beam flicker

    calculate beam origin from ship position
    store beam coordinates for next-frame erasure
    fuel_beam_position_flag = 1
    draw both beam lines in yellow
```

## Edge Cases and Design Notes

- **Pod must NOT be attached**: `pod_attached_flag_1` is explicitly checked. The player must choose between carrying the pod and refuelling. This is a key strategic tension in the game.
- **Counter is per-canister**: Each fuel object has its own `obj_tractor_counter` entry. Partial progress on one canister doesn't affect others.
- **Counter never resets**: Progress accumulates across multiple hover passes. There's no timeout or decay.
- **`collecting_fuel_flag` is per-frame**: Reset to 0 at the start of each object update cycle. Only set during the frame when conditions are actively met.
- **Fuel adds every frame, beam draws every other frame**: The mechanical benefit (fuel increase) is continuous, but the visual flickers for aesthetic effect.
- **Demo mode blocked**: `add_fuel` checks `demo_mode_flag` and returns immediately if in demo mode, preventing fuel accumulation during attract sequences.
- **Beam colour is always yellow**: Uses pixel byte $0F (colour 1), which is the ship colour on every level — never changes with level palette.

## Constants Summary

```typescript
// Fuel collection
const OBJECT_FUEL = 0x04;
const FUEL_PICKUP_RANGE_X = 6;          // max horizontal distance (exclusive of 0)
const FUEL_PICKUP_RANGE_Y = 0x1C;       // max vertical distance (28)
const FUEL_TRACTOR_THRESHOLD = 0x1A;    // 26 ticks to consume canister
const FUEL_SCORE_VALUE = 0x30;          // BCD 300 points
const FUEL_ADD_PER_FRAME = 0x11;        // BCD fuel units added per frame

// Beam visuals
const BEAM_SHIP_Y_OFFSET = 0x14;        // 20 pixels below ship centre
const BEAM_SHIP_X_OFFSET = 0x04;        // 4 units right of ship position
const BEAM_LINE_LENGTH_Y = 0x1E;        // 30 pixels vertical span
const BEAM_LINE1_WIDTH = 0x0A;          // 10 pixels horizontal span
const BEAM_LINE2_GAP = 0x0C;            // 12 pixels gap between line ends
const BEAM_LINE2_WIDTH = 0x08;          // 8 pixels horizontal span
const BEAM_PIXEL_BYTE = 0x0F;           // colour 1 only (yellow)

// Tractor counter table
const OBJ_TRACTOR_COUNTER_SIZE = 12;    // max objects with tractor counters
```
