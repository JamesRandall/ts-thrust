# Thrust: Star Field System — Implementation Reference

This document describes how the background star field works in the original BBC Micro version of Thrust (6502 assembly by Jeremy C. Smith, 1986), covering star generation, positioning, lifetime, rendering, and the altitude threshold that controls where stars appear. Use this as a specification for the TypeScript reimplementation.

## Overview

Stars are stationary particles that appear in the sky above the terrain. They share the general particle system (same slots, same update/draw loop) but have zero velocity and are only generated when the viewport is above a certain altitude. The star field creates the impression of open sky versus underground caverns.

## Altitude Threshold

Stars are only generated when the camera is high enough in the world. The check is on `window_ypos_EXT`, which is the high byte of the viewport's Y position in world coordinates:

```
IF window_ypos_EXT >= $02:
    return  // too deep underground — no stars
```

The world Y coordinate system uses two bytes: `window_ypos_INT` (low byte, 0–255) and `window_ypos_EXT` (high byte). Y increases downward (larger values = deeper). So the total Y range is 0–65535, and the star threshold at `window_ypos_EXT < $02` means stars only appear when the viewport's Y position is in the range $0000–$01FF (0–511).

The terrain surface on most levels sits at around `window_ypos_EXT = $01` (the starting position for levels 0 and 1 has `window_ypos_EXT = $01`). So stars appear when the player is near or above the surface, and stop generating as the player descends into the cave systems below (where `window_ypos_EXT` reaches $02 or higher).

This means the star field exists in roughly the top 512 vertical world units. Given that the screen viewport is approximately $49 (73) scanlines tall and each scanline maps to one Y unit, the star region is about 7 screen-heights deep from the very top of the world.

## Generation: `particles_generate_stars`

Stars are generated in `particles_generate_stars`, called at the top of `particles_update_and_draw` every frame.

### Generation Rate

```
IF (level_tick_counter & 0x01) != 0:
    return  // only generate on even frames
```

One star is spawned every other frame (when the tick counter is even), provided the altitude check passes and a free particle slot is available.

### Star Position

```
slot = particle_return_free_slot_in_Y()

// Y position: random offset + $64 (100), giving range $64–$163 (100–355)
y_int = rnd() + $64
y_int_hi = carry from addition  // 0 or 1

// X position: random within viewport + small offset
x_int = (rnd_B & $3F) + window_xpos_INT + $05
// rnd_B & $3F gives 0–63, plus window X + 5
// This places stars within or near the visible viewport horizontally
```

The Y position is in **world coordinates**, not screen coordinates. The random byte (0–255) plus $64 gives a range of $64–$163 (100–355), potentially spanning `ypos_INT_HI` values of 0 and 1. This overlaps with the visible range when the viewport is at low altitudes (small `window_ypos_EXT` values).

The X position is relative to the current viewport X plus a random 0–63 offset plus 5, placing stars within the currently visible horizontal span (the viewport is approximately $48/72 columns wide, and the random range of 0–63 plus the 5-unit offset fits within that).

### Star Properties

```
particles_dx_FRAC[slot] = 0    // no X velocity
particles_dx_INT[slot]  = 0
particles_dy_FRAC[slot] = 0    // no Y velocity
particles_dy_INT[slot]  = 0

// Lifetime: preserve PARTICLE_flag bit, set to PARTICLE_lifetime_star (30)
particles_lifetime[slot] = (particles_lifetime[slot] & $80) | $1E

// Type: randomly 1 or 2
particles_type[slot] = (rnd_B & $01) + 1
```

Stars have **zero velocity** — they don't move. They simply appear at their generated position and persist for 30 ticks before expiring.

### Star Particle Types

Stars randomly alternate between type 1 (debris) and type 2 (star):

| Type | Pixel Byte | Colour |
|---|---|---|
| 1 (debris) | $FF | Both colour channels — white appearance |
| 2 (star) | $0F | Colour 1 only — yellow (ship colour) |

This gives the star field a mix of white and yellow points, adding visual variety.

## Lifetime and Expiry

Stars live for exactly 30 ticks (`PARTICLE_lifetime_star = $1E`). The standard particle update loop handles decrement:

```
lifetime = particles_lifetime[x]
IF lifetime == 0: skip (dead)
lifetime -= 1
particles_lifetime[x] = lifetime
IF lifetime == 0: skip (just died this frame)
// ... continue to move and render
```

Since stars have zero velocity, the `particle_move_index_X` call each tick has no effect on their position — they stay fixed in world space. As the viewport scrolls, stars that leave the visible area are killed by the screen bounds check.

## Rendering

Stars are rendered by the same particle XOR rendering code as all other particles. The process:

1. **World-to-screen conversion**: Subtract viewport position from particle world position.
2. **Terrain collision**: Check particle X against `terrain_left_wall` and `terrain_right_wall` at the particle's Y scanline. If outside the terrain walls (i.e. inside solid ground), the particle is killed (lifetime set to 0).
3. **Screen bounds check**: The particle must be within the visible viewport. Horizontal: 0 to $48. Vertical: $11 to $7E (after subtracting $38 from the Y offset). If outside, skip rendering.
4. **XOR plot**: Look up pixel byte from type, apply position-based sub-pixel mask, XOR two bytes onto screen memory.

### Terrain Collision Kills Stars Underground

The terrain wall check is crucial: even though stars generate at high Y positions (low altitude), if the viewport happens to be positioned such that a star's screen-mapped Y coordinate falls within a terrain-enclosed area, the star is killed. This prevents stars from appearing inside cave walls or underground chambers. In practice, since stars only generate when `window_ypos_EXT < 2` and the terrain surface defines the sky/ground boundary, stars naturally appear above the terrain.

### XOR Erasure

When a star's `PARTICLE_flag` ($80) bit is set in its lifetime byte, it means the star was plotted last frame. The update loop XORs the stored pixel bytes back at the stored screen address to erase it before either re-rendering at the (same) position or letting it expire.

## Star Seeding at Game Start: `generate_stars_to_start`

When the game first starts (before the title screen or attract mode), a pre-seeding routine runs to fill the sky with stars so the star field isn't empty on the first visible frame:

```
window_xpos_INT = 0
window_ypos_EXT = 0    // altitude 0 — top of world, stars will generate

FOR window_xpos_INT = 0 to 255:
    particles_update_and_draw()   // generates + updates stars
    level_tick_counter += 1
    wait(3)                        // brief delay per step
```

This loops 256 times, incrementing `window_xpos_INT` each time. Since `particles_generate_stars` runs every other tick and generates stars at positions relative to `window_xpos_INT`, this seeds stars across the full X range of the world. The result is a pre-populated star field that appears natural from the first frame of gameplay.

## Interaction with Particle Slot System

Stars use the same 31-slot particle system (slots 1–31) as debris, hostile bullets, and explosion particles. Player bullets have exclusive use of slots 0–3.

`particle_return_free_slot_in_Y` finds a free slot by scanning from slot 31 down to 1, looking for a slot with lifetime == 0. If none is found, it looks for a slot with lifetime < 10 (nearly expired). Since stars live for 30 ticks and one is generated every 2 frames, at steady state there are approximately 15 stars alive at any time. This leaves ample room for explosion debris and other particles.

However, during intense combat with many explosions (which spawn 8 particles each), star slots may be cannibalised by the free slot finder's "nearly expired" fallback. This is by design — combat effects take visual priority over background stars.

## State Flow

```
EACH FRAME (in particles_update_and_draw):
    |
    v
particles_generate_stars():
    IF window_ypos_EXT >= 2: return  (underground)
    IF level_tick_counter is odd: return  (every other frame)
    Find free slot
    Set random Y position ($64 + rnd, world coords)
    Set random X position (viewport-relative, 0–63 + window_x + 5)
    Set zero velocity
    Set lifetime to 30
    Set type to 1 or 2 (random)
    |
    v
Standard particle update loop (for all particles including stars):
    Erase previous frame if PARTICLE_flag set
    Decrement lifetime, skip if dead
    Move particle (no-op for stars — zero velocity)
    Terrain wall collision check → kill if inside terrain
    Screen bounds check → skip if off-screen
    XOR render at screen position
```

## Constants Summary

```typescript
// Star generation
const STAR_ALTITUDE_THRESHOLD = 0x02;     // window_ypos_EXT must be < this
const STAR_GENERATION_MASK = 0x01;        // generate on even ticks only
const STAR_Y_OFFSET = 0x64;              // 100 — added to random Y
const STAR_X_RANDOM_MASK = 0x3F;         // 0–63 random range
const STAR_X_OFFSET = 0x05;              // added to window_xpos_INT + random

// Star properties
const PARTICLE_LIFETIME_STAR = 0x1E;     // 30 ticks
const STAR_DX = 0;                        // no horizontal velocity
const STAR_DY = 0;                        // no vertical velocity

// Star types (randomly chosen)
const STAR_TYPE_DEBRIS = 0x01;            // pixel byte $FF (white)
const STAR_TYPE_STAR = 0x02;              // pixel byte $0F (yellow)

// Particle system
const PARTICLE_FLAG = 0x80;              // "rendered on screen" flag in lifetime byte
const PARTICLE_SLOT_MIN = 1;             // stars use slots 1–31
const PARTICLE_SLOT_MAX = 31;

// Star seeding
const STAR_SEED_ITERATIONS = 256;        // full X range at game start
const STAR_SEED_DELAY = 3;               // wait ticks per iteration
```

## Design Notes for TypeScript Implementation

**Stars are fixed in world space**: Unlike the original where stars have zero velocity and the XOR rendering handles scrolling naturally (stars that scroll off-screen are killed by bounds checks), the TypeScript version will need to handle the world-to-screen transformation explicitly. Stars should be stored in world coordinates and projected to screen coordinates each frame based on the viewport position.

**Generation is viewport-relative**: New stars spawn at positions within or near the current viewport. As the player scrolls, old stars expire (30-tick lifetime) and new ones generate in the new viewport area. This creates a seamless scrolling star field without needing to pre-populate the entire world.

**Altitude transition**: The cutoff at `window_ypos_EXT >= 2` is a hard threshold — stars simply stop generating. There's no fade or transition. The terrain naturally obscures the boundary since the surface is typically at the same altitude, but during rapid vertical movement the player may notice stars appearing/disappearing. The original handles this gracefully because the 30-tick lifetime means existing stars persist briefly even after crossing the threshold.

**Colour mixing**: The random type selection (1 or 2) creates a 50/50 mix of white ($FF) and yellow ($0F) stars. In the TypeScript version, map these to appropriate colours based on the current level's palette, remembering that type 1 uses both colour channels and type 2 uses only colour channel 1.
