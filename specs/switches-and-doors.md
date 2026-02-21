# Thrust: Switches and Doors — Implementation Reference

This document describes how door switches and doors work in the original BBC Micro version of Thrust (6502 assembly by Jeremy C. Smith, 1986), covering the switch objects, trigger mechanism, door counter system, and the per-level door logic that directly modifies terrain walls.

## Overview

Doors are not objects — they are regions of the terrain left wall that are dynamically overwritten each tick. Switch objects (types $07 and $08) are placed in the level and when shot, they set a countdown timer. While the timer is active, the door opens; when it expires, the door closes again. Only levels 3, 4, and 5 have doors. The door logic is entirely hardcoded per level.

## Switch Objects

Two object types serve as switches:

| Type | ID | Width | Height | Sprite |
|---|---|---|---|---|
| `OBJECT_door_switch_right` | $07 | 2 | 8 | Small right-facing toggle |
| `OBJECT_door_switch_left` | $08 | 2 | 8 | Small left-facing toggle |

Switches are placed in the level object data like any other object (guns, fuel, etc.) with X, Y, and Y_EXT coordinates. They are rendered using the standard object sprite system.

### Switches Cannot Be Destroyed

Unlike guns and fuel, switches have no entry in `obj_type_explosion_particle` or `obj_type_score_value` (those tables only cover types 0–4). Shooting a switch triggers the door but does not destroy the switch or award points — it remains in place and can be shot again.

## Switch Trigger

When a player bullet hits a switch (detected in the standard bullet-vs-object collision loop):

```
IF object_type == OBJECT_door_switch_right OR object_type == OBJECT_door_switch_left:
    door_switch_counter_A = $FF    // set timer to 255
    // bullet is consumed (lifetime cleared)
    // fall through to standard hit response (debris particles)
```

The bullet is consumed and a small debris effect is created at the impact point (via the standard `L0F64` hit response), giving visual feedback. The switch object itself persists.

## Door Counter System

Two counters drive the door state:

- **`door_switch_counter_A`**: The primary timer. Set to $FF (255) when a switch is shot. Decremented by 1 every tick in `tick_door_logic`. Reaching 0 means the switch has timed out.

- **`door_switch_counter_B`**: The door position/openness. This is what actually controls how far open the door is. Its behaviour depends on the relationship with `counter_A` and a per-level threshold.

### Counter Interaction Pattern (Same Logic in All Three Levels)

Each level defines a threshold value. The pattern is:

```
IF door_switch_counter_A < threshold:
    door_switch_counter_B = door_switch_counter_A    // closing: B tracks A directly
ELSE:
    IF door_switch_counter_B < threshold:
        door_switch_counter_B += 1                   // opening: B increments toward threshold
```

This creates the behaviour:
- **Switch shot**: counter_A jumps to 255, counter_B starts incrementing by 1 per tick toward the threshold (door opens gradually)
- **Timer running**: counter_A decrements, counter_B stays at threshold (door stays fully open)
- **Timer below threshold**: counter_B = counter_A, both decrement together (door closes gradually)

The thresholds per level:

| Level | Threshold | Door Fully Open (ticks to open) |
|---|---|---|
| 3 | $10 (16) | 16 ticks |
| 4 | $15 (21) | 21 ticks |
| 5 | $12 (18) | 18 ticks |

## Per-Level Door Logic

Each level's door logic runs every tick (called from `update_window_and_terrain_tables`). It only executes when the door's Y position is within the current viewport. The door operates by directly writing values into the `terrain_left_wall` array, overriding the normal terrain data for the scanlines where the door exists.

### Visibility Guard

Each level first checks whether the door's world Y position is within the viewport:

```
screen_y = door_world_y - window_ypos
IF screen_y is not on screen: return  // door not visible, skip
```

The door world positions (hardcoded):

| Level | Door World Y (INT_HI:INT) | Expression |
|---|---|---|
| 3 | $02:$69 | `$0269` |
| 4 | $03:$43 | `$0343` |
| 5 | $03:$70 | `$0370` |

### Level 3 Door

Modifies the **left wall** at a fixed X position. The door is a vertical section of 13 scanlines ($0D).

```
door_x = $AE - door_switch_counter_B   // wall position moves left as door opens
y_start = screen_y + terrain_window_y_index

FOR 13 scanlines:
    terrain_left_wall[y_start + i] = door_x   // constant X across all scanlines
```

When `counter_B = 0` (closed), the wall is at X=$AE. As `counter_B` increases toward 16, the wall moves left to X=$9E, creating a gap. The door is a flat vertical section of the left wall that slides horizontally.

### Level 4 Door

Modifies the **left wall** over 21 scanlines ($15). Uses a two-value system — the wall has a step in it.

```
y_start = screen_y + terrain_window_y_index + $15  // offset from bottom

FOR y = 21 down to 1:
    IF y == door_switch_counter_B:
        wall_x = $98                // open section starts here
    ELSE IF y > door_switch_counter_B:
        wall_x = $A6               // closed section
    // (once switched to $98, stays at $98 for remaining scanlines)
    terrain_left_wall[y_start] = wall_x
    y_start -= 1
```

This creates a door that opens from one end — a section of the wall at X=$A6 is replaced with X=$98 (further left), and the boundary between the two values moves as `counter_B` changes, creating a sliding-door effect.

### Level 5 Door

Modifies the **left wall** over 15 scanlines (7 + 8). Creates a pointed/chevron shape that opens outward.

```
wall_x = $C0 - door_switch_counter_B   // base X, moves left as door opens
y_start = screen_y + terrain_window_y_index

// First half: 7 scanlines, X increments by 1 per scanline (angled right)
FOR 7 scanlines:
    terrain_left_wall[y_start] = wall_x
    wall_x += 1
    y_start += 1

// Second half: 8 scanlines, X decrements by 1 per scanline (angled left)
FOR 8 scanlines:
    terrain_left_wall[y_start] = wall_x
    wall_x -= 1
    y_start += 1
```

This creates a diamond/chevron-shaped protrusion in the left wall that retracts as the door opens. When closed (`counter_B = 0`), the point is at X=$C0. As it opens, the entire shape shifts left, widening the passable gap.

## Level Object Data Encoding

Switches are encoded in the per-level object tables alongside all other objects. Each level has parallel arrays:

```
level_N_obj_pos_X:    EQUB x0, x1, x2, ...     // world X position (8-bit)
level_N_obj_pos_Y:    EQUB y0, y1, y2, ...     // world Y position low byte
level_N_obj_pos_Y_EXT: EQUB e0, e1, e2, ...   // world Y position high byte
level_N_obj_type:     EQUB t0, t1, t2, ..., $FF // object type, $FF terminated
level_N_gun_param:    EQUB p0, p1, p2, ...     // gun firing parameters (0 for non-guns)
```

Object index 0 is always the pod stand ($05), index 1 is always the generator ($06). Switches, guns, and fuel fill the remaining slots.

### Switch Placements Across Levels

**Levels 0, 1, 2**: No switches, no doors.

**Level 3** (2 switches):
- Object 2: type $08 (switch left) at X=$AC, Y=$02:$51
- Object 3: type $08 (switch left) at X=$AC, Y=$02:$87

**Level 4** (2 switches):
- Object 2: type $08 (switch left) at X=$A4, Y=$03:$25
- Object 3: type $07 (switch right) at X=$98, Y=$03:$75

**Level 5** (2 switches):
- Object 2: type $07 (switch right) at X=$A1, Y=$03:$98
- Object 3: type $08 (switch left) at X=$BE, Y=$03:$5D

### Gun Parameters for Switches

Switches have `gun_param = $00` — they don't fire. The gun_param byte is only meaningful for gun object types (0–3).

## Interaction Notes

- **Any switch triggers any door**: There is only one `door_switch_counter_A` shared across all switches on a level. Shooting either switch on a level opens the same door(s). Shooting a switch while the timer is already running resets it to $FF.

- **Multiple hits extend the timer**: Each hit sets `counter_A` back to $FF, effectively resetting the countdown and keeping the door open longer.

- **Door only updates when visible**: If the player scrolls away from the door's Y position, the door logic returns early and the terrain is not modified. This means the door can appear to "snap" open or closed if the player scrolls back after the state has changed.

- **Doors modify terrain_left_wall only**: All three levels' doors operate on the left wall array. There are no right-wall doors in the game.

- **No collision with the door itself**: The door is terrain — collision is handled by the normal terrain wall collision system. When the door is closed, the wall values block passage. When open, the wall values recede and the player can pass through.

## Constants Summary

```typescript
// Object types
const OBJECT_DOOR_SWITCH_RIGHT = 0x07;
const OBJECT_DOOR_SWITCH_LEFT = 0x08;
const SWITCH_WIDTH = 2;
const SWITCH_HEIGHT = 8;

// Timer
const SWITCH_TIMER_INITIAL = 0xFF;  // 255 ticks (5.1 seconds at 50Hz)

// Per-level door parameters
const DOOR_CONFIG = {
    3: {
        worldY: 0x0269,       // door world position
        threshold: 0x10,      // 16 — ticks to fully open
        scanlines: 13,        // height of door region
        closedX: 0xAE,        // left wall X when closed
        type: 'slide',        // flat wall slides left
    },
    4: {
        worldY: 0x0343,
        threshold: 0x15,      // 21
        scanlines: 21,
        closedX: 0xA6,
        openX: 0x98,
        type: 'step',         // two-value step boundary moves
    },
    5: {
        worldY: 0x0370,
        threshold: 0x12,      // 18
        scanlines: 15,        // 7 + 8
        closedX: 0xC0,
        type: 'chevron',      // diamond shape retracts
    },
};
```
