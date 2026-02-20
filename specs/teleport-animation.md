# Thrust: Teleport Animation — Implementation Reference

This document describes the teleport effect that plays when the ship appears at level start and disappears when escaping to orbit in the original BBC Micro version of Thrust (6502 assembly by Jeremy C. Smith, 1986).

## Overview

The teleport effect is a growing then shrinking rectangular outline that XOR-renders around the ship (and around the pod, if attached). It consists of two phases: an expansion phase where the rectangle grows from the ship/pod outward over 6 steps, then a contraction phase where it shrinks back over 6 steps. On each step, the ship and pod sprites are toggled on/off, creating a flickering appearance/disappearance.

The same animation is used for both appearing (level start) and disappearing (orbit escape), with the ship/pod visibility toggled in opposite order.

## Trigger Context

### Disappearing (orbit escape)

```
player_entered_orbit:
    play enter_orbit_sound
    teleport_appear_or_disappear = $FF
    → player_teleport
```

### Appearing (level start)

```
player_teleport_appear:
    teleport_appear_or_disappear = $00
    → player_teleport
```

## Setup: `player_teleport`

Before the animation begins, the routine:

1. Saves `pod_line_exists_flag`, `plot_ship_collision_detected`, and `pod_attached_flag_1` to the stack.
2. Sets `plot_ship_collision_detected = $FF` and clears `pod_line_exists_flag` and `pod_attached_flag_1` to prevent normal rendering during the animation.
3. Calls `draw_player_timed_to_vsync` to erase the current ship/pod/line from screen.
4. Calculates two origin points for the effect rectangles:

### Ship origin

```
calculate_line_coordinates()   // gets ship and pod screen positions
// Start point = ship screen position
calculate_pixels_ptr()         // converts to screen memory address
pixels_ptr_offset_diagonal_by_4()  // offset 4 pixels up-left diagonally
// Store as: old_plot_pixels_ptr, old_pixels_ptr_mask_index
```

### Pod origin (if pod was attached)

```
// Move start point to pod screen position
draw_line_start_x = draw_line_end_x
draw_line_start_y = draw_line_end_y
calculate_pixels_ptr()
pixels_ptr_offset_diagonal_by_4()
// Store as: teleport_effect_L0082/L0083, current_obj_visible_flag
```

If the pod was NOT attached (`pod_attached_flag_1` was 0 before saving), `teleport_effect_L0083` is set to $00, which causes the pod rectangle to be skipped during rendering.

### Diagonal Offset

`pixels_ptr_offset_diagonal_by_4` moves the screen pointer 4 steps in an up-left diagonal direction (4 calls to `pixels_ptr_add_7` + `pixels_ptr_decrement`). This positions the rectangle origin above and to the left of the ship/pod centre, so the rectangle is centred on the sprite.

## Animation: `do_teleport_animation`

The animation has two phases, 6 steps each, for a total of 12 frames.

### Phase 1: Expansion (6 steps)

```
teleport_L0086 = 0

FOR step = 1 to 6:
    teleport_L0086 += 1
    plot_teleport_effect_1()    // draw rectangles at current size
    toggle_ship_visibility()    // conditional on appear/disappear
    draw_player_timed_to_vsync()  // render frame, wait for vsync
```

Each step, `teleport_L0086` increases by 1, which controls the rectangle size (see below).

### Phase 2: Contraction (6 steps)

```
FOR step = 6 down to 1:
    toggle_ship_visibility()    // twice per step
    toggle_ship_visibility()
    draw_player_timed_to_vsync()
    plot_teleport_effect_1()    // draw rectangles at current size
    teleport_L0086 -= 1
```

### Ship Visibility Toggling

The toggle behaviour differs between appear and disappear:

**Disappearing** (`teleport_appear_or_disappear = $FF`):

During expansion (phase 1), each step calls `L325B` which checks the flag. Since it's $FF (non-zero), it jumps straight to `draw_player_timed_to_vsync` — the ship is always drawn.

During contraction (phase 2), each step calls `L3255` twice. Since the flag is $FF, it jumps to `L3261` which checks if `teleport_L0086 < 3`. If so, it clears `plot_ship_collision_detected`, `pod_line_exists_flag`, and `pod_attached_flag_1` to zero — making the ship invisible. Otherwise it draws normally.

Result: ship visible during expansion, disappears during the last 2 steps of contraction (when size < 3).

**Appearing** (`teleport_appear_or_disappear = $00`):

During expansion, `L325B` checks the flag. Since it's $00, it goes to `L3261` which checks `teleport_L0086 < 3`. For the first 2 steps (size 1 and 2), the ship is made invisible. For steps 3–6, the ship is drawn normally.

Result: ship appears at step 3 of expansion, visible through contraction.

## Rectangle Rendering: `plot_teleport_effect_1`

This draws the effect at both the ship and pod positions.

### Ship Rectangle

```
pixels_ptr_pixel_byte = $0F     // colour 1 only (yellow — ship colour)
origin = old_plot_pixels_ptr
plot_teleport_effect_2()
```

### Pod Rectangle (if attached)

```
pixels_ptr_pixel_byte = $FF     // both colours (white)
origin = teleport_effect_L0082/L0083
IF teleport_effect_L0083 == 0: skip  // pod was not attached
plot_teleport_effect_2()
```

The ship effect is yellow, the pod effect is white.

## Rectangle Shape: `plot_teleport_effect_2`

Each call to `plot_teleport_effect_2` draws a rectangle outline at the current size by rendering four sides. The rectangle is drawn using self-modifying code that swaps the horizontal and vertical step functions for each side.

The four sides are drawn in order:

### Side 1: Right and Down (top side, moving right)

```
step_horizontal = pixels_ptr_add_7    // move right
step_vertical   = pixels_ptr_increment  // move down
plot_teleport_effect_3()
```

### Side 2: Left and Down (right side, moving down then left)

```
step_horizontal = pixels_ptr_sbc_8    // move left

// First, move left 9 steps to reach the opposite side
FOR i = 1 to 9: pixels_ptr_sbc_8()

plot_teleport_effect_3()              // draw with left + down
```

### Side 3: Left and Up (bottom side, moving left)

```
step_horizontal = pixels_ptr_decrement  // move left (vertical screen direction)
step_vertical   = pixels_ptr_add_7      // move up (horizontal screen direction)

// Offset by 1 step to connect corners
pixels_ptr_add_7()
pixels_ptr_decrement()

plot_teleport_effect_3()
```

### Side 4: Right and Up (left side, moving up then right)

```
step_horizontal = pixels_ptr_increment  // move right (vertical)

// Move right 9 steps
FOR i = 1 to 9: pixels_ptr_increment()

plot_teleport_effect_3()
```

Note: The BBC Micro's MODE 1 screen memory layout means "horizontal" in screen memory (`pixels_ptr_add_7` / `pixels_ptr_sbc_8`) corresponds to horizontal pixel movement, while `pixels_ptr_increment` / `pixels_ptr_decrement` correspond to vertical pixel movement.

## Side Drawing: `plot_teleport_effect_3`

Each side draws a series of 8-pixel-tall strips arranged in a rectangle outline:

```
save screen pointer

// Move horizontally by teleport_L0086 steps (the current size)
FOR i = 1 to teleport_L0086:
    step_horizontal()

// Draw strips
remaining = teleport_L0086
WHILE remaining > 0:
    save pointer
    // Draw one vertical strip: 8 pixels tall
    FOR i = 1 to 8:
        plot_teleport_pixels()   // XOR one pixel at current position
        step_vertical()          // move to next scanline
    restore pointer

    // Move horizontally to next strip position
    FOR i = 1 to 8:
        step_horizontal()
    remaining -= 1

restore screen pointer
```

Each "strip" is 1 pixel wide and 8 pixels tall (one character cell height). The number of strips equals `teleport_L0086` (1–6), and they're spaced 8 horizontal steps apart, making the total rectangle width proportional to the step count.

### Pixel Plotting

`plot_teleport_pixels` XORs a single pixel onto the screen:

```
mask = pixel_masks_1[pixels_ptr_mask_index]  // $88, $44, $22, or $11
pixel = mask AND pixels_ptr_pixel_byte       // apply colour
screen[plot_pixels_ptr] ^= pixel             // XOR onto screen
```

Since rendering is XOR-based, calling `plot_teleport_effect_1` twice with the same size erases the previous frame's rectangles.

## Animation Timing

Each step includes a call to `draw_player_timed_to_vsync`, which waits for the vsync signal and draws the ship/pod. This means each animation step takes approximately 1/50th of a second (one PAL frame). The full animation is 12 steps = approximately 240ms.

## Rectangle Size Progression

| Step | teleport_L0086 | Phase | Ship Visible (disappear) | Ship Visible (appear) |
|---|---|---|---|---|
| 1 | 1 | expand | yes | no |
| 2 | 2 | expand | yes | no |
| 3 | 3 | expand | yes | yes |
| 4 | 4 | expand | yes | yes |
| 5 | 5 | expand | yes | yes |
| 6 | 6 | expand | yes | yes |
| 7 | 6 | contract | yes | yes |
| 8 | 5 | contract | yes | yes |
| 9 | 4 | contract | yes | yes |
| 10 | 3 | contract | yes | yes |
| 11 | 2 | contract | no | yes |
| 12 | 1 | contract | no | yes |

## Constants Summary

```typescript
// Animation
const TELEPORT_STEPS = 6;              // steps in each phase (expand + contract)
const TELEPORT_TOTAL_FRAMES = 12;      // 6 expand + 6 contract
const TELEPORT_FRAME_DURATION = 1 / 50; // one PAL frame per step

// Ship visibility threshold
const TELEPORT_VISIBILITY_THRESHOLD = 3; // ship invisible when size < 3

// Diagonal offset from sprite centre to rectangle origin
const TELEPORT_DIAGONAL_OFFSET = 4;    // pixels up-left

// Strip dimensions
const TELEPORT_STRIP_HEIGHT = 8;       // pixels (one character cell)
const TELEPORT_STRIP_SPACING = 8;      // horizontal steps between strips

// Colours
const TELEPORT_SHIP_PIXEL_BYTE = 0x0F;  // colour 1 (yellow)
const TELEPORT_POD_PIXEL_BYTE = 0xFF;   // both colours (white)

// Direction flag
const TELEPORT_DISAPPEAR = 0xFF;
const TELEPORT_APPEAR = 0x00;
```
