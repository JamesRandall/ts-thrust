# Thrust: Level Cycling and Modifiers — Implementation Reference

This document describes the level cycling system, reverse gravity, and invisible landscape modifiers in the original BBC Micro version of Thrust (6502 assembly by Jeremy C. Smith, 1986).

## Level Cycling

The game has 6 levels (0–5). When the player completes level 5, `level_number` resets to 0 and gameplay modifiers toggle. The `mission_number` (BCD, starting at 1) increments indefinitely and is purely cosmetic.

### Modifier Toggle Logic

On every wrap from level 5 back to level 0:

```
reverse_gravity_flag ^= $FF   // toggle between $00 and $FF

IF reverse_gravity_flag == $00:
    // reverse gravity just turned OFF — toggle invisible landscape
    invisible_landscape_flag ^= $0F   // toggle between $00 and $0F
```

The `invisible_landscape_flag` is only toggled when `reverse_gravity_flag` transitions from on to off. This produces the following repeating pattern:

| Cycle | Missions | reverse_gravity | invisible_landscape |
|---|---|---|---|
| 1 | 1–6 | OFF ($00) | OFF ($00) |
| 2 | 7–12 | **ON** ($FF) | OFF ($00) |
| 3 | 13–18 | OFF ($00) | **ON** ($0F) |
| 4 | 19–24 | **ON** ($FF) | **ON** ($0F) |
| 5 | 25–30 | OFF ($00) | OFF ($00) |
| ... | ... | pattern repeats every 24 missions | |

The full pattern repeats every 4 cycles (24 missions). The first cycle is vanilla. The second adds reverse gravity. The third swaps to invisible landscape. The fourth has both.

### Modifier Messages

Each modifier displays a message the **first time** it activates, gated by a flag that prevents re-display:

```
IF reverse_gravity_flag != 0 AND reverse_gravity_msg_shown == 0:
    display "REVERSE GRAVITY"
    reverse_gravity_msg_shown = $96    // also used as wait timeout

IF invisible_landscape_flag != 0 AND invisible_landscape_msg_shown == 0:
    display "INVISIBLE LANDSCAPE"
    invisible_landscape_msg_shown = $96
```

These messages only appear once per game session. The flags are never reset, so subsequent activations of the same modifier are silent.

## Reverse Gravity

### Effect on Physics

In `initialise_level_pointers`, after loading the per-level `gravity_FRAC`:

```
IF reverse_gravity_flag != 0:
    gravity_FRAC = gravity_FRAC EOR $FF    // ones complement (negate fractional part)
    gravity_INT = $FF                       // -1 in signed byte
ELSE:
    gravity_INT = $00                       // normal: positive downward
```

Normal gravity: `gravity_INT = $00`, `gravity_FRAC` = per-level value. Force is small and positive — pulls downward (Y increases downward in the original coordinate system).

Reverse gravity: `gravity_INT = $FF`, `gravity_FRAC` = ~per-level value. Force is small and negative — pulls upward.

### Effect on Starting Orientation

When reverse gravity is active, the player spawns pointing downward instead of up:

```
IF gravity_INT < 0:   // reverse gravity
    ship_angle = $10          // angle 16 — pointing straight down
    angle_ship_to_pod = $11   // pod hangs above (angle 17)
ELSE:                  // normal gravity
    ship_angle = $00          // angle 0 — pointing straight up (default from ZP clear)
    angle_ship_to_pod = $01   // pod hangs below (angle 1)
```

The ship angle is set to face against gravity (nose pointing into the pull) so the player can thrust to counteract gravity immediately. The pod angle is offset by 1 from straight-down-relative-to-gravity so it hangs on the gravity-facing side of the ship.

### Gameplay Impact

Everything else works identically — thrust, damping, collision, terrain — only the direction of the gravitational force changes. The player must mentally invert their thrust strategy. The terrain is the same, so sections that were easy to navigate downward become harder upward and vice versa.

## Invisible Landscape

### How It Works

The invisible landscape is a **palette trick**. The terrain is still drawn every frame using the normal rendering code. Collision detection is unchanged — the `terrain_left_wall` and `terrain_right_wall` arrays are fully populated. Only the visual representation is hidden.

### Palette Manipulation

`hide_landscape` is called every tick at the start of the tick loop, before rendering:

```
hide_landscape:
    IF planet_countdown_timer == 0: goto set_black  // always hide during countdown=0
    IF pod_destroying_player_timer >= 0: return     // player dying — leave palette alone
    IF invisible_landscape_flag == 0: return         // not an invisible level — leave alone
    IF shield_tractor_pressed == 0: goto set_black  // shield NOT held — hide terrain
    goto show_landscape                              // shield held — REVEAL terrain

set_black:
    palette colour 2 = $00 (black)

show_landscape:
    palette colour 2 = level_landscape_colour[level_number]
```

The critical sequence: `hide_landscape` runs first (sets terrain to black), then all rendering occurs (terrain is drawn in colour 2 which is now black against the black background — invisible), then if the shield is held, `show_landscape` is called to reveal.

Actually more precisely: `hide_landscape` checks if the shield is held. If it is, it calls `show_landscape` instead of setting black. This means the landscape is visible for the entire frame when the shield is active.

### Shield Reveals Terrain

Holding the shield/tractor beam key (spacebar) causes `hide_landscape` to call `show_landscape` instead of setting colour 2 to black. This restores the landscape colour, making the terrain visible **while the key is held**. Releasing the key causes the next tick to set colour 2 back to black.

This creates the signature gameplay mechanic: the player must tap the shield key to briefly see the terrain, burning fuel with each press, then fly blind between pulses. The 2-on-2-off flicker pattern of the shield (gated by `vsync_count & $02`) means the terrain flashes in sync with the shield visual and fuel consumption.

### Line Drawing Pixel Byte

At level initialisation:

```
level_line_pixels_byte = $F0 | invisible_landscape_flag
hostile_bullet_pixel_byte = $F0 | invisible_landscape_flag
```

Normally `invisible_landscape_flag = $00`, so both are `$F0` (colour 2 only — landscape colour). When invisible, `invisible_landscape_flag = $0F`, so both become `$FF` (both colour channels — white).

This means on invisible landscape levels:
- Terrain lines are drawn with pixel byte `$FF` instead of `$F0`
- Hostile bullets use `$FF` instead of `$F0`

Since colour 2 is black (terrain hidden) and colour 3 is the object colour, `$FF` renders as the object colour only. The terrain is technically drawn but in a colour that only shows against certain backgrounds. The hostile bullets similarly change appearance. When the shield reveals the landscape, both terrain and bullets become fully visible in their combined colours.

### Tether Line on Invisible Levels

The tether line between ship and pod normally uses pixel byte `$F0` (landscape colour). On invisible levels this would make the tether invisible too. The pod attachment system handles this — the tether line colour is set from `level_line_pixels_byte`, which becomes `$FF` on invisible levels, making the tether white/visible regardless of landscape visibility.

## State Flow

```
GAME START:
    reverse_gravity_flag = $00
    invisible_landscape_flag = $00
    level_number = -1 (incremented to 0 on first start_new_level)

EACH start_new_level:
    level_number += 1
    IF level_number == 6:
        level_number = 0
        reverse_gravity_flag ^= $FF
        IF reverse_gravity_flag == 0:
            invisible_landscape_flag ^= $0F
        // Display modifier message if first time

EACH initialise_level_pointers:
    Load gravity_FRAC from per-level table
    IF reverse_gravity_flag:
        gravity_FRAC = ~gravity_FRAC
        gravity_INT = $FF
    ELSE:
        gravity_INT = $00
    level_line_pixels_byte = $F0 | invisible_landscape_flag
    hostile_bullet_pixel_byte = $F0 | invisible_landscape_flag

EACH TICK (invisible landscape active):
    hide_landscape:
        IF shield held: show_landscape (colour 2 = level colour)
        ELSE: colour 2 = black
    // ... render terrain (drawn but invisible against black)
    // ... render everything else
```

## Constants Summary

```typescript
// Level cycling
const NUM_LEVELS = 6;

// Modifier flags
const REVERSE_GRAVITY_ON = 0xFF;
const REVERSE_GRAVITY_OFF = 0x00;
const INVISIBLE_LANDSCAPE_ON = 0x0F;
const INVISIBLE_LANDSCAPE_OFF = 0x00;

// Reverse gravity starting angles
const SHIP_ANGLE_NORMAL = 0x00;      // pointing up
const SHIP_ANGLE_REVERSE = 0x10;     // pointing down (angle 16)
const POD_ANGLE_NORMAL = 0x01;       // pod below
const POD_ANGLE_REVERSE = 0x11;      // pod above (angle 17)

// Pixel bytes
const TERRAIN_PIXEL_NORMAL = 0xF0;   // colour 2 only (landscape)
const TERRAIN_PIXEL_INVISIBLE = 0xFF; // both colours (white)

// Palette
const PALETTE_COLOUR_LANDSCAPE = 2;  // colour index for terrain
const PALETTE_BLACK = 0x00;

// Modifier cycle pattern (repeats every 4 cycles = 24 missions)
// Cycle 1: normal
// Cycle 2: reverse gravity
// Cycle 3: invisible landscape
// Cycle 4: reverse gravity + invisible landscape
```
