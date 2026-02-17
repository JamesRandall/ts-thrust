# Thrust: Generator System — Implementation Reference

This document describes the generator object's behaviour in the original BBC Micro version of Thrust (6502 assembly by Jeremy C. Smith, 1986), covering its destruction mechanics, recharge system, smoke particle effect, and interactions with guns and the planet countdown. Use this as a specification for the TypeScript reimplementation.

## Overview

The generator (object type `OBJECT_generator`, $06) is the central strategic target on each level. It controls whether hostile guns can fire. Destroying it — or hitting it enough times — eventually triggers the planet's self-destruct countdown. The generator is not a one-hit-kill; it uses a cumulative damage model with an escalating recharge timer.

## Generator State Variables

| Variable | Init Value | Description |
|---|---|---|
| `generator_recharge_counter` | $0F (15) at level reset, $32 (50) via `initialise_level_pointers` | Ticks remaining until generator recharges. Decremented every other frame. While non-zero, guns cannot fire and smoke is suppressed. |
| `generator_recharge_increase` | $32 (50) at level start | Cumulative damage accumulator. Added to the random component on each hit, making successive hits produce longer recharge times. |
| `planet_countdown_timer` | $FF (-1, inactive) | Set to $0A (10) when generator damage overflows. Counts down in seconds. When it reaches 0, the player's ship is destroyed. |
| `countdown_timer_ticks` | — | Sub-second tick counter. Set to $20 (32) and decremented each frame; when it hits 0, `planet_countdown_timer` decrements by 1. |

## Hit Detection

Generator hits use the same `bullet_test_loop` as other objects (see explosion-system.md), but with the generator's specific dimensions:

| Property | Value |
|---|---|
| Width | 5 |
| Height | 10 ($0A) |

When a bullet hits the generator, the code does NOT go through the standard `destroy_object` path. Instead it branches to `handle_generator`.

## Hit Response: `handle_generator`

### Step 1: Impact Debris

The shared routine at `L0F64` is called, which:

1. Records the bullet's position as the explosion origin:
   - `explosion_xpos_INT = particles_xpos_INT[bullet]`
   - `explosion_ypos_INT = particles_ypos_INT[bullet]`
   - `explosion_ypos_INT_HI = particles_ypos_INT_HI[bullet]`
2. Sets `explosion_particle_type = 4` (random debris mode).
3. Calls `create_explosion`.

In random debris mode (`type == 4`), `create_explosion` spawns only **3 particles** (not the usual 8), picks a random starting angle, and randomises the debris type to either 1 or 2:

```
particle_count = 3
explosion_particle_type = (level_tick_counter & 1) + 1
explosion_angle = rnd() & 0x1F
```

This produces a small localised spark effect at the bullet impact point, not a full object-destruction explosion.

### Step 2: Calculate New Recharge Time

```
new_recharge = (rnd() & 0x1F) + generator_recharge_increase
generator_recharge_counter = new_recharge
generator_recharge_increase = new_recharge
```

The key mechanic: `generator_recharge_increase` is both an input and an output. Each hit adds a random 0–31 on top of the accumulated value, then stores the result back. This means:

- **Hit 1**: recharge ≈ 50 + rand(0–31) = ~50–81
- **Hit 2**: recharge ≈ (50–81) + rand(0–31) = ~50–112
- **Hit 3**: recharge ≈ (50–112) + rand(0–31) = ~50–143
- ...and so on, escalating until overflow

### Step 3: Check for Overflow (Planet Destruction)

The addition `(rnd() & 0x1F) + generator_recharge_increase` is an 8-bit operation. If it produces a carry (result > 255):

```
IF carry from addition:
    IF planet_countdown_timer >= 0 (already counting down or at zero):
        // Countdown already active — just set max recharge
        generator_recharge_counter = $FF (255)
    ELSE:
        // First overflow — start planet self-destruct
        generator_recharge_counter = $FF
        planet_countdown_timer = $0A  (10 seconds)
        countdown_timer_ticks = $01   (start immediately)
```

If there is **no carry** (result fits in 8 bits):

```
    // Generator is "deleted" — removed from level
    jump to remove_object_from_level
```

This is a critical detail: **if the recharge value doesn't overflow, the generator is removed from the level entirely**. If it overflows, the generator stays but the planet starts self-destructing (or the recharge timer is maxed if countdown is already active).

In practice, the first few hits tend to remove the generator (recharge fits in a byte), while later hits when `generator_recharge_increase` is already high are more likely to trigger the overflow and thus the countdown.

### Step 4: Score

Note: the generator hit does **not** award score directly. The small debris explosion at the impact point is purely visual. Score is only awarded when guns or fuel pods are destroyed.

## Recharge Counter Decrement

In `end_of_objects_function`, the recharge counter is decremented every other frame:

```
IF (level_tick_counter & 0x01) == 0:
    IF generator_recharge_counter > 0:
        generator_recharge_counter -= 1
```

This means the recharge counter effectively ticks at half the frame rate. A recharge value of 100 takes 200 frames to expire.

## Effect on Hostile Guns

In the gun firing logic (within `update_and_draw_all_objects`), guns check the recharge counter before firing:

```
// For each gun object:
IF object_type >= OBJECT_fuel:  skip  // only guns fire
IF generator_recharge_counter != 0:  skip  // generator stunned — no firing
IF planet_countdown_timer >= 0:  skip  // countdown active — no firing
// ... otherwise, guns may fire based on probability
```

So while the generator is recharging (counter > 0), **all guns on the level are disabled**. This is the player's reward for hitting the generator.

## Planet Countdown Timer

Once triggered, the countdown timer works as follows (in `end_of_objects_function`):

```
countdown_timer_ticks -= 1
IF countdown_timer_ticks < 0:
    countdown_timer_ticks = $20  (32 frames per second tick)

    IF planet_countdown_timer < 0:  return  // inactive
    IF planet_countdown_timer == 0:
        // Time's up — no sound, just display
    ELSE:
        planet_countdown_timer -= 1
        play_sound(sound_params_collect_1)  // countdown beep

    // Display countdown digit on screen
    font_byte_mask = $FF
    display_char(planet_countdown_timer + ASCII_0)  // at two screen positions

    font_byte_mask = $0F
    IF planet_countdown_timer == 0:
        // Planet explodes — destroy the player
        plot_ship_collision_detected = 1
        pod_attached_flag_2 = $FF
```

When the timer reaches 0, the player is killed via collision detection flag, regardless of shield status.

### Countdown and Object Behaviour

While the countdown is active (`planet_countdown_timer >= 0`), additional effects occur during object updates:

- All non-pod-stand objects are destroyed with explosions on each tick (the planet-exploding cascade)
- The generator flashes: every 4 ticks, its visibility flag is toggled (bit 1 of `level_obj_flags`), creating a blinking effect via:

```
IF object_type == OBJECT_generator AND planet_countdown_timer >= 0 AND planet_countdown_timer != 0:
    IF (countdown_timer_ticks & 0x04) != 0:
        level_obj_flags[x] |= 0x02   // visible
    ELSE:
        level_obj_flags[x] &= ~0x02  // invisible
```

## Generator Smoke Particle Effect

When the generator is active and healthy, it emits upward-moving smoke particles. This is handled in the object update loop, after the gun firing logic.

### Trigger Conditions

All of the following must be true:

```
(level_tick_counter & 0x07) == 0      // every 8th frame
object_type == OBJECT_generator       // only generators
generator_recharge_counter == 0       // fully recharged (not stunned)
planet_countdown_timer < 0            // no countdown active (high bit set = $FF = inactive)
```

### Smoke Particle Properties

```
slot = find_free_particle_slot()

particle.xpos_INT  = current_obj_xpos_INT + 4    // centred on generator (width 5)
particle.xpos_FRAC = 0
particle.dx_FRAC   = 0
particle.dx_INT    = 0                            // no horizontal movement
particle.ypos_INT  = current_obj_ypos_INT         // top of generator
particle.ypos_INT_HI = current_obj_ypos_EXT
particle.dy_FRAC   = $8E                          // fractional upward velocity
particle.dy_INT    = $FF                           // -1 + 0.55 ≈ -0.45 units/tick (upward)
particle.type      = PARTICLE_type_debris ($01)
particle.lifetime  = (existing_lifetime & PARTICLE_FLAG) | PARTICLE_lifetime_generator ($0A)
```

### Smoke Behaviour Summary

- Spawned every 8 frames when the generator is operational
- Rises straight upward at approximately -0.45 units per tick (dy = $FF8E in Q8.8 signed)
- Lives for 10 ticks (`PARTICLE_lifetime_generator = $0A`)
- Rendered as debris type ($01), which uses pixel byte $FF (both colour channels — white)
- No horizontal drift — moves in a perfectly vertical column
- Subject to the same terrain collision and screen-bounds checks as all other particles
- Suppressed whenever the generator is stunned (recharge counter > 0) or the planet countdown is active

### Visual Purpose

The smoke serves as a visual indicator of generator health: when you hit the generator, the smoke stops. When it starts again, you know the recharge is complete and guns are about to reactivate. This gives the player a clear visual cue for timing their next attack.

## Full State Machine Summary

```
LEVEL START
    generator_recharge_counter = $0F (briefly stunned)
    generator_recharge_increase = $32
    planet_countdown_timer = $FF (inactive)
    |
    v
GENERATOR ACTIVE (recharge_counter == 0)
    - Guns can fire
    - Smoke particles emitted every 8 frames
    - Waiting for player bullet hit
    |
    | [bullet hits generator]
    v
CALCULATE RECHARGE
    new_value = (rnd & $1F) + generator_recharge_increase
    generator_recharge_increase = new_value
    |
    |--- [no carry] ---> GENERATOR REMOVED FROM LEVEL
    |                     (guns permanently disabled,
    |                      no smoke, no further hits possible)
    |
    |--- [carry, countdown inactive] ---> PLANET COUNTDOWN STARTED
    |                                      recharge_counter = $FF
    |                                      countdown = 10 seconds
    |                                      generator flashes
    |                                      guns disabled
    |
    |--- [carry, countdown active] ---> RECHARGE MAXED
    |                                    recharge_counter = $FF
    |                                    countdown continues
    v
GENERATOR STUNNED (recharge_counter > 0)
    - Guns cannot fire
    - No smoke particles
    - Counter decrements every 2 frames
    |
    | [recharge_counter reaches 0]
    v
GENERATOR ACTIVE (loop back)
```

## Constants Summary

```typescript
// Generator-specific
const OBJECT_GENERATOR = 0x06;
const GENERATOR_WIDTH  = 5;
const GENERATOR_HEIGHT = 10;
const GENERATOR_INITIAL_RECHARGE = 0x0F;        // 15 ticks at level reset
const GENERATOR_INITIAL_RECHARGE_INCREASE = 0x32; // 50 at level start
const GENERATOR_SMOKE_INTERVAL = 8;              // every 8th frame
const GENERATOR_SMOKE_X_OFFSET = 4;              // centred on generator

// Smoke particle
const GENERATOR_SMOKE_DY_FRAC = 0x8E;
const GENERATOR_SMOKE_DY_INT  = 0xFF;  // signed: -1 + 0x8E/256 ≈ -0.45
const GENERATOR_SMOKE_DX      = 0;     // no horizontal movement
const PARTICLE_LIFETIME_GENERATOR = 0x0A;  // 10 ticks

// Planet countdown
const PLANET_COUNTDOWN_SECONDS = 10;        // $0A
const PLANET_COUNTDOWN_TICKS_PER_SECOND = 32; // $20
const PLANET_COUNTDOWN_INACTIVE = 0xFF;     // high bit set = no countdown

// Impact debris (small explosion on bullet hit)
const GENERATOR_HIT_DEBRIS_COUNT = 3;  // not the full 8
const GENERATOR_HIT_DEBRIS_TYPE  = 4;  // random debris mode in create_explosion

// Recharge
const GENERATOR_RECHARGE_DECREMENT_MASK = 0x01; // only decrement on even frames
const GENERATOR_RECHARGE_MAX = 0xFF;            // set on overflow
```

## Interaction with Other Systems

### Gun Firing Suppression

While `generator_recharge_counter > 0` OR `planet_countdown_timer >= 0`, no hostile gun on the level will fire. The check happens per-gun in the object update loop.

### Planet Explosion Animation

When the countdown triggers planet destruction, `planet_explode_anim` is set to $0F (15) and decrements every other vsync in the IRQ handler. During this time, the background colour cycles through `background_colour_table`, creating a screen-flash effect. This is purely visual and handled in the IRQ — the generator system just sets the initial value.

### Hostile Gun Probability Modifier

If the planet was destroyed (countdown reached 0), `planet_destroyed_hostile_gun_modifier` is set to 8 at the end-of-level screen. This is added to `hostile_gun_shoot_probability` at the start of the next level, making guns more aggressive as punishment for destroying the planet.
