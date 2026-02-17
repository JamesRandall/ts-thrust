# Thrust: Explosion System — Implementation Reference

This document describes how explosions work in the original BBC Micro version of Thrust (6502 assembly by Jeremy C. Smith, 1986) when a player bullet destroys an object. Use this as a specification for the TypeScript reimplementation.

## Overview

Explosions are triggered when a player bullet collides with a destructible object (guns or fuel pods). The system creates a ring of 8 debris particles radiating outward from the object's centre, with randomised velocities and lifetimes.

## Trigger: Bullet-to-Object Hit Detection

The collision check runs in `bullet_test_loop`, iterating over particle slots 0–3 (the 4 player bullet slots). For each active bullet:

1. **Type check**: Only particles with `type == PARTICLE_type_player_bullet` ($00) and a non-zero lifetime are tested.
2. **Bounding box test (X)**: `particles_xpos_INT[x] - current_obj_xpos_INT` must be >= 0 and < `obj_type_width[object_type]`.
3. **Bounding box test (Y)**: `particles_ypos_INT[x] - current_obj_ypos_INT` (with high-byte check against `current_obj_ypos_EXT`) must be >= 0 and < `obj_type_height[object_type]`.

### Object Dimensions

| Object Type | ID | Width | Height |
|---|---|---|---|
| Gun (up-right) | 0 | 5 | 8 |
| Gun (down-right) | 1 | 5 | 8 |
| Gun (up-left) | 2 | 5 | 8 |
| Gun (down-left) | 3 | 5 | 8 |
| Fuel | 4 | 4 | 10 |

Only guns and fuel have entries in the explosion/score tables; pod stand, generator, and door switches have separate handling paths.

### On Hit

The bullet's lifetime is masked to just `PARTICLE_flag` ($80), effectively killing it as an active bullet while preserving the flag bit for the particle renderer. The code then branches based on object type.

## Destruction Flow (Guns, types 0–3)

For guns, the flow reaches `destroy_object`:

1. **Clear visibility**: `level_obj_flags[current_object] &= ~0x02` — removes the object from rendering.
2. **Calculate explosion origin**: Object position offset to approximate centre:
   - `explosion_xpos_INT = current_obj_xpos_INT + 2`
   - `explosion_ypos_INT = current_obj_ypos_INT + 4`
   - `explosion_ypos_INT_HI = current_obj_ypos_EXT + carry`
3. **Accumulate score**: Calls `accumulate_score_A` with the value from `obj_type_score_value` (guns = $75, which is BCD for 750 points when the trailing zero is added by the display).
4. **Create explosion**: Calls `create_explosion` with `explosion_particle_type` set from `obj_type_explosion_particle` (guns = $02, star-type debris).
5. **Remove object**: Jumps to `remove_object_from_level_GUESS` to clean up the object entry.

### Score Values (BCD)

| Object Type | Score Value | Display Score |
|---|---|---|
| Gun (all 4 types) | $75 | 750 |
| Fuel | $15 | 150 |

## The `create_explosion` Routine

This is the core explosion particle spawner.

### Parameters

- `explosion_xpos_INT`, `explosion_xpos_FRAC` — X origin
- `explosion_ypos_INT`, `explosion_ypos_INT_HI` — Y origin
- `explosion_particle_type` — particle type for debris (from `obj_type_explosion_particle`)

### Algorithm

```
particle_count = 8
explosion_angle = random starting angle (from previous context or level_tick_counter)

IF explosion_particle_type == 4 (random debris, used for door switch/generator hits):
    particle_count = 3
    explosion_particle_type = (level_tick_counter & 1) + 1  // type 1 or 2
    explosion_angle = rnd() & 0x1F  // random 0–31

FOR each particle (particle_count down to 1):
    slot = find_free_particle_slot()

    // Set position to explosion origin
    particle.xpos_FRAC = explosion_xpos_FRAC
    particle.xpos_INT  = explosion_xpos_INT
    particle.ypos_INT  = explosion_ypos_INT
    particle.ypos_INT_HI = explosion_ypos_INT_HI

    // Calculate base velocity from angle
    random_offset = rnd() & 0x03           // 0–3
    angle = (explosion_angle + random_offset) & 0x1F
    base_dx_FRAC = angle_to_x_FRAC[angle]
    base_dx_INT  = angle_to_x_INT[angle]
    base_dy_FRAC = angle_to_y_FRAC[angle]
    base_dy_INT  = angle_to_y_INT[angle]

    // Scale down by dividing by 16 (arithmetic right shift x4)
    // Preserves sign bit across the shift
    base_dx = (base_dx_INT:base_dx_FRAC) >>> 4
    base_dy = (base_dy_INT:base_dy_FRAC) >>> 4

    // Randomise magnitude: accumulate base velocity 2–5 times
    magnitude = (rnd_B & 0x03) + 2
    particle.dx = 0
    particle.dy = 0
    FOR i = 1 to magnitude:
        particle.dx += base_dx
        particle.dy += base_dy

    // Calculate semi-random lifetime
    // Based on inverse of magnitude, RNG, and particle flag state
    lifetime_base = (magnitude << 3) ^ 0x1F  // inverse relationship
    carry_from_flag = (particles_lifetime[slot] & 0x80) ? 1 : 0
    lifetime = ((rnd_A & 0x0F) >> 1) + lifetime_base + 8
    // (with carry from the flag rotation feeding into the add)
    particle.lifetime = lifetime
    particle.type = explosion_particle_type

    // Advance angle for next particle (roughly even spacing)
    explosion_angle = (explosion_angle + 4) & 0x1F

    // Give particle an initial 2-tick kick
    move_particle(slot)  // advance position by dx,dy
    move_particle(slot)  // advance position by dx,dy again
```

### Key Implementation Notes

**Angle spacing**: Each particle advances the explosion angle by 4 out of 32 total angles. With 8 particles, that's `8 × 4 = 32`, covering the full circle. The random offset (0–3) per particle adds variation so the ring isn't perfectly uniform.

**Velocity scaling**: The division by 16 (4 arithmetic right shifts) on the angle lookup values is critical. Without it, debris would fly at bullet speed. The sign bit is preserved through `ROL A` before each `ROR` to implement arithmetic (signed) right shift.

**Magnitude variation**: The 2–5x accumulation means some particles travel roughly 2.5x faster than others, creating a non-uniform burst rather than a perfect expanding ring.

**Lifetime inversely correlates with speed**: Faster particles (higher magnitude) get shorter lifetimes due to the `(magnitude << 3) ^ 0x1F` calculation. This means all particles travel roughly similar total distances despite different speeds — a nice visual design choice.

**Initial kick**: The two `particle_move_index_X` calls at the end push each particle 2 frames of movement from the origin before rendering begins, preventing a visible cluster at the centre on the first frame.

## Particle Movement (`particle_move_index_X`)

Each tick, every active particle is moved by its velocity:

```
particle.xpos_FRAC += particle.dx_FRAC
particle.xpos_INT  += particle.dx_INT  (+ carry)
particle.ypos_FRAC += particle.dy_FRAC
particle.ypos_INT  += particle.dy_INT  (+ carry)
particle.ypos_INT_HI += sign_extend(particle.dy_INT) + carry
```

The Y position uses 3 bytes (FRAC, INT, INT_HI) because the world is taller than 256 units. The sign extension ensures negative dy values correctly decrement the high byte.

## Particle Lifetime and Rendering

In `particles_update_and_draw`, each tick:

1. If `PARTICLE_flag` ($80) is set in lifetime, the particle was rendered last frame — erase it by XORing the stored pixel bytes back at the stored screen address.
2. Decrement lifetime. If zero, skip (particle is dead).
3. Move the particle via `particle_move_index_X`.
4. Perform terrain collision: check the particle's X position against `terrain_left_wall` and `terrain_right_wall` at the particle's Y index. If outside, kill the particle (lifetime = 0).
5. Perform screen bounds check: if the particle is outside the visible window, kill it.
6. If still alive, calculate screen address, look up pixel byte from `lookup_particle_type_to_pixel_byte` (type 0 = $FF, type 1 = $FF, type 2 = $0F), XOR it onto the screen, and set `PARTICLE_flag`.

### Pixel Byte by Type

| Type | Value | Colour |
|---|---|---|
| 0 (player bullet) | $FF | Both colours (white) |
| 1 (debris) | $FF | Both colours (white) |
| 2 (star) | $0F | Colour 1 only (yellow, the ship colour) |
| 3 (hostile bullet) | $F0 | Colour 2 only (landscape colour, but overridden by `hostile_bullet_pixel_byte`) |

Note: The hostile bullet pixel byte is stored separately at `hostile_bullet_pixel_byte` and can be modified when invisible landscape mode is active.

## Particle Slot Management

`particle_return_free_slot_in_Y` finds a free slot:

1. Scan slots 31 down to 1. Return first slot with lifetime == 0 (completely free).
2. If none found, scan again for any slot with remaining lifetime < 10 (nearly expired).
3. If still none found, the code enters an infinite loop (a bug/failsafe that shouldn't trigger in practice due to slot count vs active particles).

Player bullets occupy slots 0–3 exclusively. Stars, debris, and hostile bullets use slots 1–31 via the free slot finder. The `PARTICLE_flag` bit ($80) in lifetime indicates "currently rendered on screen" and is separate from the active lifetime counter (lower 7 bits).

## Constants Summary

```typescript
const PARTICLE_FLAG            = 0x80;
const PARTICLE_LIFETIME_BULLET = 0x28;  // 40 ticks
const PARTICLE_LIFETIME_GENERATOR = 0x0A;  // 10 ticks (generator smoke)
const PARTICLE_LIFETIME_STAR   = 0x1E;  // 30 ticks
const PARTICLE_TABLE_MAX       = 0x1F;  // 31 slots (0–31)

const PARTICLE_TYPE_PLAYER_BULLET  = 0x00;
const PARTICLE_TYPE_DEBRIS         = 0x01;
const PARTICLE_TYPE_STAR           = 0x02;
const PARTICLE_TYPE_HOSTILE_BULLET = 0x03;

const EXPLOSION_PARTICLE_COUNT = 8;
const EXPLOSION_ANGLE_STEP     = 4;   // out of 32 total angles
const EXPLOSION_VELOCITY_SHIFT = 4;   // divide by 16
const EXPLOSION_INITIAL_KICK   = 2;   // frames of movement before first render

const MAX_PLAYER_BULLETS = 4;  // slots 0–3
```
